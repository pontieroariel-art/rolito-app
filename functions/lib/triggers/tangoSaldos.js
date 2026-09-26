"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncSaldosTango = void 0;
exports.indiceClientesTango = indiceClientesTango;
exports.descuentosPendientes = descuentosPendientes;
exports.procesarLoteSaldos = procesarLoteSaldos;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firestore_1 = require("firebase-admin/firestore");
const empresas_1 = require("../services/tango/empresas");
const saldos_1 = require("../services/tango/saldos");
const tangoBridgeSecret = (0, params_1.defineSecret)('TANGO_BRIDGE_SECRET');
// Mismo criterio que syncClientesTango: el bridge manda lotes chicos, esto solo
// acota costo/DoS si el secret se filtrara.
const MAX_ROWS_POR_LOTE = 2000;
async function indiceClientesTango(db) {
    const usersSnap = await db.collection('users').where('rol', '==', 'cliente').get();
    const indice = { redonhielo: new Map(), rolito: new Map() };
    usersSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const ids = (0, empresas_1.tangoIdsDe)(data);
        for (const empresa of empresas_1.EMPRESAS) {
            for (const id of ids[empresa] ?? []) {
                indice[empresa].set(id.idGva14, {
                    uid: docSnap.id, codigo: id.codigo, razonSocial: data.razonSocial, nombre: data.nombre,
                    codigoTango: ids.redonhielo?.[0]?.codigo ?? data.codigoTango, idGva14Tango: ids.redonhielo?.[0]?.idGva14 ?? data.idGva14Tango,
                });
            }
        }
    });
    return indice;
}
// Cobranzas completas de los últimos 90 días que Tango todavía no confirmó
// (ver descuentosDeCobranzas): se restan del snapshot para no resucitar deuda
// ya cobrada. Una cobranza que no llegó a Tango en 3 meses es un problema a
// resolver a mano, no a seguir descontando en silencio.
async function descuentosPendientes(db) {
    const desde = new Date();
    desde.setDate(desde.getDate() - 90);
    const snap = await db.collection('cobranzas').where('fecha', '>=', desde).get();
    return (0, saldos_1.descuentosDeCobranzas)(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}
/**
 * Escribe en el cache los comprobantes de `opts.empresa` de los clientes de
 * `rows` (el resto del doc — la otra empresa — queda como está). Con
 * `esUltimoLote` vacía la rama de esa empresa en los docs que no tocó esta
 * corrida (runId): son clientes que ya no deben nada ahí.
 */
async function procesarLoteSaldos(db, rows, opts) {
    const empresa = opts.empresa ?? ((0, empresas_1.esEmpresa)(rows[0]?.empresa) ? rows[0].empresa : 'redonhielo');
    const indice = (opts.indice ?? await indiceClientesTango(db))[empresa];
    const descuentos = opts.descuentos ?? await descuentosPendientes(db);
    let actualizados = 0;
    let sinCambios = 0;
    let skippedNoMatch = 0;
    let vaciados = 0;
    const wouldUpdate = [];
    const sinMatch = [];
    // Varios ID_GVA14 (códigos) pueden ser la misma cuenta: se juntan por uid.
    const porUid = new Map();
    for (const row of rows) {
        const cliente = indice.get(row.idGva14);
        if (!cliente) {
            skippedNoMatch++;
            if (opts.dryRun && sinMatch.length < 300) {
                const saldo = (0, saldos_1.redondear2)((row.comprobantes ?? []).reduce((s, c) => s + Number(c.saldoPendiente ?? 0), 0));
                sinMatch.push({ idGva14: row.idGva14, codigo: row.codGva14 ?? '', nombre: row.razonSocial ?? '', saldo });
            }
            continue;
        }
        const codigo = row.codGva14 || cliente.codigo;
        const comprobantes = (row.comprobantes ?? []).map((c) => (0, saldos_1.normalizarComprobante)(c, empresa, codigo));
        if (!porUid.has(cliente.uid))
            porUid.set(cliente.uid, { cliente, comprobantes: [] });
        porUid.get(cliente.uid).comprobantes.push(...comprobantes);
    }
    let batch = db.batch();
    let enBatch = 0;
    const flush = async () => {
        if (enBatch === 0)
            return;
        if (!opts.dryRun)
            await batch.commit();
        batch = db.batch();
        enBatch = 0;
    };
    // Saldo a favor en Tango (2026-09-24): lo publica el lector SQL en tangoComprobantes.aCuenta.
    // Entra como líneas negativas; un cliente que SOLO tiene plata a favor no viene en la Live
    // de deudas, así que acá se lo agrega a la lista.
    const porCodigo = new Map();
    for (const c of indice.values())
        porCodigo.set(c.codigo, c);
    const aCuentaSnap = await db.collection('tangoComprobantes').where('aCuenta.total', '>', 0).get();
    let conSaldoAFavor = 0;
    for (const d of aCuentaSnap.docs) {
        const x = d.data();
        if (x.empresa !== empresa)
            continue;
        const codigo = String(x.codigo ?? '');
        const cliente = porCodigo.get(codigo);
        if (!cliente)
            continue;
        const creditos = (0, saldos_1.creditosACuentaDelIndice)(x.aCuenta, empresa, codigo);
        if (!creditos.length)
            continue;
        conSaldoAFavor++;
        if (!porUid.has(cliente.uid))
            porUid.set(cliente.uid, { cliente, comprobantes: [] });
        const entrada = porUid.get(cliente.uid);
        entrada.comprobantes = (0, saldos_1.conCreditosACuenta)(entrada.comprobantes, creditos);
    }
    if (conSaldoAFavor)
        console.log(`[syncSaldos] ${empresa}: ${conSaldoAFavor} clientes con saldo a favor en Tango`);
    // Los refs se arman DESPUÉS de sumar a los clientes que solo tienen saldo a favor:
    // armados antes, esos uids no estaban en `uids`, `refs[uids.indexOf(uid)]` daba
    // undefined y `batch.set` tiraba "documentRef is not a valid DocumentReference":
    // la corrida entera se caía (del 24/09 a la noche al 26/09 no se actualizó ningún saldo).
    const uids = [...porUid.keys()];
    const refs = uids.map((uid) => db.collection('saldosTango').doc(uid));
    const actuales = new Map();
    if (refs.length && !opts.dryRun) {
        for (let i = 0; i < refs.length; i += 300) {
            const snaps = await db.getAll(...refs.slice(i, i + 300));
            for (const s of snaps)
                actuales.set(s.id, s.exists ? s.data() : undefined);
        }
    }
    for (const [uid, { cliente, comprobantes: crudos }] of porUid) {
        const descuento = descuentos.get(uid);
        const comprobantes = (0, saldos_1.aplicarDescuentos)(crudos, descuento);
        const actual = actuales.get(uid);
        const nuevo = (0, saldos_1.fusionarRamaEmpresa)(actual, empresa, comprobantes, { runId: opts.runId, origen: 'sync', ahora: firestore_1.FieldValue.serverTimestamp() }, {
            // Identidad "principal" del doc (legacy): la de Redonhielo si la hay.
            idGva14: cliente.idGva14Tango ?? actual?.idGva14 ?? 0,
            codigoTango: cliente.codigoTango ?? actual?.codigoTango ?? cliente.codigo,
            razonSocial: actual?.razonSocial || cliente.razonSocial || cliente.nombre || '',
        }, descuento ? descuento.cobranzaIds : []);
        if (opts.dryRun) {
            if (wouldUpdate.length < 20)
                wouldUpdate.push({ uid, empresa, saldoEmpresa: nuevo.porEmpresa[empresa]?.saldoTotal, comprobantes: comprobantes.length });
            actualizados++;
            continue;
        }
        opts.tocados?.add(uid);
        if (opts.tocados && (0, saldos_1.mismaRama)(actual, nuevo, empresa)) {
            sinCambios++;
            continue;
        }
        batch.set(db.collection('saldosTango').doc(uid), { ...nuevo, actualizadoEn: firestore_1.FieldValue.serverTimestamp() });
        actualizados++;
        enBatch++;
        if (enBatch >= 400)
            await flush();
    }
    await flush();
    // Cierre de corrida con `tocados`: los deudores de esta empresa que no
    // aparecieron en ningún lote ya no deben nada ahí → se vacía solo esa rama.
    // Se consulta por comprobantes > 0 (solo los que tienen deuda) y se traen
    // completos únicamente los que hay que vaciar.
    if (opts.esUltimoLote && opts.runId && !opts.dryRun && opts.tocados) {
        const runId = opts.runId;
        const conDeuda = await db.collection('saldosTango').where(`porEmpresa.${empresa}.comprobantes`, '>', 0).select().get();
        const aVaciarIds = conDeuda.docs.map((d) => d.id).filter((id) => !opts.tocados.has(id));
        for (let i = 0; i < aVaciarIds.length; i += 300) {
            const snaps = await db.getAll(...aVaciarIds.slice(i, i + 300).map((id) => db.collection('saldosTango').doc(id)));
            const b = db.batch();
            for (const s of snaps) {
                if (!s.exists)
                    continue;
                b.set(s.ref, { ...(0, saldos_1.vaciarRamaEmpresa)(s.data(), empresa, runId, firestore_1.FieldValue.serverTimestamp()), actualizadoEn: firestore_1.FieldValue.serverTimestamp() });
                vaciados++;
            }
            await b.commit();
        }
        return { succeeded: true, dryRun: false, received: rows.length, actualizados, sinCambios, skippedNoMatch, vaciados };
    }
    // Cierre de corrida: todo doc cuya rama de ESTA empresa no fue tocada por
    // este runId es un cliente que ya no debe nada ahí → se vacía solo esa rama
    // (no se borra: conserva la otra empresa, la identidad y el "actualizado hace X").
    if (opts.esUltimoLote && opts.runId && !opts.dryRun && !opts.tocados) {
        const runId = opts.runId;
        const viejos = await db.collection('saldosTango').where(`porEmpresa.${empresa}.runId`, '!=', runId).get();
        const aVaciar = new Map(viejos.docs.map((d) => [d.id, d]));
        if (empresa === 'redonhielo') {
            // Docs anteriores al formato por empresa (sin porEmpresa): eran solo de Redonhielo.
            const legacy = await db.collection('saldosTango').where('runId', '!=', runId).get();
            for (const d of legacy.docs)
                if (!d.data().porEmpresa)
                    aVaciar.set(d.id, d);
        }
        let batchLimpieza = db.batch();
        let enLimpieza = 0;
        for (const docSnap of aVaciar.values()) {
            const vacio = (0, saldos_1.vaciarRamaEmpresa)(docSnap.data(), empresa, runId, firestore_1.FieldValue.serverTimestamp());
            batchLimpieza.set(docSnap.ref, { ...vacio, actualizadoEn: firestore_1.FieldValue.serverTimestamp() });
            vaciados++;
            enLimpieza++;
            if (enLimpieza >= 400) {
                await batchLimpieza.commit();
                batchLimpieza = db.batch();
                enLimpieza = 0;
            }
        }
        if (enLimpieza > 0)
            await batchLimpieza.commit();
    }
    return {
        succeeded: true,
        dryRun: opts.dryRun,
        received: rows.length,
        actualizados,
        sinCambios,
        skippedNoMatch,
        vaciados,
        ...(opts.dryRun ? { wouldUpdate, sinMatch } : {}),
    };
}
// Recibe la composición de saldos de los clientes desde el script del bridge
// (scripts/tango/bridge-sync-saldos.mjs — reemplazado por syncSaldosTangoConnect
// el 2026-09-03; queda por compatibilidad). Bearer secret angosto.
exports.syncSaldosTango = (0, https_1.onRequest)({ secrets: [tangoBridgeSecret], invoker: 'public' }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ succeeded: false, reason: 'method not allowed' });
        return;
    }
    const authHeader = req.headers.authorization ?? '';
    if (authHeader !== `Bearer ${tangoBridgeSecret.value()}`) {
        res.status(401).json({ succeeded: false, reason: 'unauthorized' });
        return;
    }
    const db = (0, firestore_1.getFirestore)();
    const dryRun = req.body?.dryRun === true;
    if (!dryRun) {
        const cfgSnap = await db.doc('config/tango').get();
        const cfg = cfgSnap.data();
        if (cfg?.enabled !== true || cfg?.saldosEnabled !== true) {
            res.status(200).json({ succeeded: false, dryRun, reason: 'sync de saldos deshabilitado via config/tango (enabled + saldosEnabled)' });
            return;
        }
    }
    const rows = req.body?.rows;
    if (!Array.isArray(rows)) {
        res.status(400).json({ succeeded: false, reason: 'rows[] requerido' });
        return;
    }
    if (rows.length > MAX_ROWS_POR_LOTE) {
        res.status(413).json({ succeeded: false, reason: `demasiadas filas (${rows.length} > ${MAX_ROWS_POR_LOTE}); enviá lotes más chicos` });
        return;
    }
    const runId = typeof req.body?.runId === 'string' ? req.body.runId : null;
    const esUltimoLote = req.body?.esUltimoLote === true;
    try {
        const resultado = await procesarLoteSaldos(db, rows, { dryRun, runId, esUltimoLote, empresa: 'redonhielo' });
        res.status(200).json(resultado);
    }
    catch (err) {
        console.error('[syncSaldosTango] error procesando lote:', err);
        res.status(500).json({ succeeded: false, reason: err instanceof Error ? err.message : String(err) });
    }
});
//# sourceMappingURL=tangoSaldos.js.map