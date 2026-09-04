"use strict";
// Clientes, saldos y consultas de saldo: Tango → app por Tango Connect, sin
// pasar por la VM (2026-09-03, reemplaza a scripts/tango/bridge-sync-clientes.mjs,
// bridge-sync-saldos.mjs y la parte de tango-consultas de bridge-listener.mjs).
//
// Misma lógica de negocio que antes: la lectura de Tango se hace acá con
// TangoClient y las filas se le pasan a las mismas funciones que ya usaban
// las Functions HTTP del bridge (procesarLoteClientesTango, procesarLoteSaldos),
// así el matching de clientes, los descuentos de cobranzas pendientes y el
// vaciado del cache de saldos no cambian. Ver docs/tango/INTEGRACION.md §18.
Object.defineProperty(exports, "__esModule", { value: true });
exports.onConsultaSaldoPendiente = exports.sincronizarSaldosTangoAhora = exports.sincronizarClientesTangoAhora = exports.syncSaldosTangoConnect = exports.syncClientesTangoConnect = void 0;
exports.recortarCliente = recortarCliente;
exports.sincronizarClientes = sincronizarClientes;
exports.recortarComprobante = recortarComprobante;
exports.sincronizarSaldos = sincronizarSaldos;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const v2_1 = require("firebase-functions/v2");
const firestore_2 = require("firebase-admin/firestore");
const client_1 = require("../services/tango/client");
const pedido_1 = require("../services/tango/pedido");
const tangoSync_1 = require("./tangoSync");
const tangoSaldos_1 = require("./tangoSaldos");
const rateLimit_1 = require("../rateLimit");
const tangoApiToken = (0, params_1.defineSecret)('TANGO_API_TOKEN');
const CONNECT_BASE_URL_DEFAULT = 'https://001174-003.connect.axoft.com';
const TZ = 'America/Argentina/Buenos_Aires';
const ROLES_QUE_SINCRONIZAN = new Set(['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion']);
const ROLES_SALDOS = new Set([...ROLES_QUE_SINCRONIZAN, 'supervisor']);
// Consultas Live de composición de saldos (Redonhielo). Mismos procesos que
// usaba el bridge; se pueden pisar desde config/tango.saldos.
const PROCESO_DEUDAS_VENCIDAS_DEFAULT = 17953;
const PROCESO_DEUDAS_A_VENCER_DEFAULT = 17955;
const FROM_DATE_DEFAULT = '01/01/2015';
async function contexto() {
    const db = (0, firestore_2.getFirestore)();
    const cfg = ((await db.doc('config/tango').get()).data() ?? {});
    if (cfg.enabled !== true)
        throw new https_1.HttpsError('failed-precondition', 'config/tango.enabled está apagado');
    const tango = new client_1.TangoClient({ baseUrl: cfg.connectBaseUrl ?? CONNECT_BASE_URL_DEFAULT, token: tangoApiToken.value(), timeoutMs: 60000 });
    return { db, cfg, tango };
}
function companyDe(cfg, empresa) {
    const c = cfg.companies?.[empresa];
    if (!Number.isInteger(c))
        throw new https_1.HttpsError('failed-precondition', `config/tango.companies.${empresa} no está configurado`);
    return c;
}
function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
}
const str = (v) => (v == null || v === '' ? undefined : String(v));
// ── Clientes ─────────────────────────────────────────────────────────────────
// Mismo recorte que hacía bridge-sync-clientes.mjs sobre la fila de process 2117.
function recortarCliente(c) {
    return {
        idGva14: Number((0, pedido_1.prop)(c, 'ID_GVA14')),
        codGva14: String((0, pedido_1.prop)(c, 'COD_GVA14') ?? '').trim(),
        cuit: String((0, pedido_1.prop)(c, 'CUIT') ?? ''),
        razonSocial: str((0, pedido_1.prop)(c, 'RAZON_SOCI')),
        email: str((0, pedido_1.prop)(c, 'E_MAIL')),
        telefono1: str((0, pedido_1.prop)(c, 'TELEFONO_1')),
        telefono2: str((0, pedido_1.prop)(c, 'TELEFONO_2')),
        telefonoMovil: str((0, pedido_1.prop)(c, 'TELEFONO_MOVIL')),
        condicionVentaDesc: str((0, pedido_1.prop)(c, 'GVA01_DESC_COND')),
        categoriaIvaCodigo: str((0, pedido_1.prop)(c, 'COD_CATEGORIA_IVA')),
        categoriaIvaDesc: str((0, pedido_1.prop)(c, 'DESC_CATEGORIA_IVA')),
        vendedorCodigo: str((0, pedido_1.prop)(c, 'GVA23_CODIGO')),
        domicilio: str((0, pedido_1.prop)(c, 'DOMICILIO')) ?? str((0, pedido_1.prop)(c, 'DIR_COM')),
        localidad: str((0, pedido_1.prop)(c, 'LOCALIDAD')),
        provinciaDesc: str((0, pedido_1.prop)(c, 'GVA18_DESCRIPCION')),
        codigoPostal: str((0, pedido_1.prop)(c, 'C_POSTAL')),
        fechaAlta: str((0, pedido_1.prop)(c, 'FECHA_ALTA')),
    };
}
async function sincronizarClientes(db, tango, cfg) {
    const company = companyDe(cfg, 'redonhielo');
    const filas = await tango.getAll(company, client_1.PROCESOS.clientes, 200);
    const rows = filas.map(recortarCliente).filter((r) => Number.isInteger(r.idGva14) && r.codGva14);
    const resumen = {
        recibidos: rows.length, lotes: 0, actualizados: 0, matchedByIdGva14: 0, matchedByCuit: 0,
        newlyLinkedCodigoTango: 0, skippedNoMatch: 0, skippedAmbiguousCuit: 0, emailsActualizados: 0, emailsConError: 0, errores: [],
    };
    for (const lote of chunk(rows, 300)) {
        const r = await (0, tangoSync_1.procesarLoteClientesTango)(db, lote, { dryRun: false });
        resumen.lotes++;
        resumen.actualizados += r.actualizados ?? 0;
        resumen.matchedByIdGva14 += r.matchedByIdGva14 ?? 0;
        resumen.matchedByCuit += r.matchedByCuit ?? 0;
        resumen.newlyLinkedCodigoTango += r.newlyLinkedCodigoTango ?? 0;
        resumen.skippedNoMatch += r.skippedNoMatch ?? 0;
        resumen.skippedAmbiguousCuit += r.skippedAmbiguousCuit ?? 0;
        resumen.emailsActualizados += r.emailsActualizados ?? 0;
        resumen.emailsConError += r.emailsConError ?? 0;
        if (r.errores?.length && resumen.errores.length < 50)
            resumen.errores.push(...r.errores.slice(0, 50 - resumen.errores.length));
    }
    return resumen;
}
async function correrClientes(origen, uid) {
    const { db, cfg, tango } = await contexto();
    if (cfg.syncCloud?.clientes === false)
        throw new https_1.HttpsError('failed-precondition', 'config/tango.syncCloud.clientes está apagado');
    const inicio = Date.now();
    const resumen = await sincronizarClientes(db, tango, cfg);
    await db.doc('config/tango').set({
        clientesSync: { ultimaCorrida: firestore_2.FieldValue.serverTimestamp(), origen, uid: uid ?? null, duracionMs: Date.now() - inicio, resumen },
    }, { merge: true });
    v2_1.logger.info(`[tango] clientes sincronizados (${origen}) en ${Date.now() - inicio}ms: ${JSON.stringify({ ...resumen, errores: resumen.errores.length })}`);
    return resumen;
}
// ── Saldos (composición de deuda por cliente) ────────────────────────────────
// dd/MM/yyyy — el único formato de fecha que acepta GetApiLiveQueryData.
function ddMMyyyy(d) {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
const soloFecha = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : '');
// Mismo recorte que bridge-sync-saldos.mjs / bridge-listener.mjs.
function recortarComprobante(f) {
    const idGva12 = (0, pedido_1.prop)(f, 'ID_GVA12');
    const dias = (0, pedido_1.prop)(f, 'DIAS_DE_ATRASO');
    const venc = (0, pedido_1.prop)(f, 'FECHA_DE_VENCIMIENTO');
    return {
        tipo: String((0, pedido_1.prop)(f, 'TIPO_COMPROBANTE') ?? ''),
        numero: String((0, pedido_1.prop)(f, 'NRO_COMPROBANTE') ?? ''),
        fechaEmision: soloFecha((0, pedido_1.prop)(f, 'FECHA_DE_EMISION')),
        ...(venc ? { fechaVencimiento: soloFecha(venc) } : {}),
        importeOriginal: Number((0, pedido_1.prop)(f, 'IMPORTE_AL_VENCIMIENTO_CTE') ?? 0),
        saldoPendiente: Number((0, pedido_1.prop)(f, 'IMPORTE_PENDIENTE_CTE') ?? 0),
        ...(typeof idGva12 === 'number' ? { idComprobanteTango: idGva12 } : {}),
        ...(typeof dias === 'number' && dias > 0 ? { diasAtraso: dias } : {}),
    };
}
// "ACH082 - HANZA MARIA ELENA" → { codigo, nombre }
function parseCliente(campo) {
    const s = String(campo ?? '');
    const idx = s.indexOf(' - ');
    return idx === -1 ? { codigo: '', nombre: s } : { codigo: s.slice(0, idx).trim(), nombre: s.slice(idx + 3).trim() };
}
/** Todas las filas de deuda (vencidas + a vencer) de una empresa. */
async function filasDeuda(tango, cfg, company) {
    const desde = cfg.saldos?.fromDate ?? FROM_DATE_DEFAULT;
    const hastaDate = new Date();
    hastaDate.setFullYear(hastaDate.getFullYear() + 5); // "a vencer" incluye vencimientos futuros
    const hasta = ddMMyyyy(hastaDate);
    const vencidas = cfg.saldos?.procesoDeudasVencidas ?? PROCESO_DEUDAS_VENCIDAS_DEFAULT;
    const aVencer = cfg.saldos?.procesoDeudasAVencer ?? PROCESO_DEUDAS_A_VENCER_DEFAULT;
    const filas = await tango.live(company, vencidas, desde, hasta);
    filas.push(...await tango.live(company, aVencer, desde, hasta));
    return filas;
}
async function sincronizarSaldos(db, tango, cfg) {
    const company = companyDe(cfg, 'redonhielo');
    const filas = await filasDeuda(tango, cfg, company);
    const porCliente = new Map();
    for (const f of filas) {
        const idGva14 = (0, pedido_1.prop)(f, 'ID_GVA14');
        if (typeof idGva14 !== 'number')
            continue;
        if (!porCliente.has(idGva14)) {
            const { codigo, nombre } = parseCliente((0, pedido_1.prop)(f, 'CLIENTE'));
            porCliente.set(idGva14, { idGva14, codGva14: codigo || undefined, razonSocial: nombre || undefined, empresa: 'redonhielo', comprobantes: [] });
        }
        porCliente.get(idGva14).comprobantes.push(recortarComprobante(f));
    }
    const rows = [...porCliente.values()];
    // runId identifica la corrida completa: al llegar el último lote, todo doc
    // del cache que no fue tocado por este runId se vacía (cliente sin deuda).
    const runId = new Date().toISOString();
    const lotes = chunk(rows, 100);
    const resumen = { filas: filas.length, clientesConDeuda: rows.length, lotes: 0, actualizados: 0, skippedNoMatch: 0, vaciados: 0 };
    if (lotes.length === 0)
        lotes.push([]); // nadie debe nada: igual hay que vaciar el cache viejo
    for (const [i, lote] of lotes.entries()) {
        const r = await (0, tangoSaldos_1.procesarLoteSaldos)(db, lote, { dryRun: false, runId, esUltimoLote: i === lotes.length - 1 });
        resumen.lotes++;
        resumen.actualizados += r.actualizados ?? 0;
        resumen.skippedNoMatch += r.skippedNoMatch ?? 0;
        resumen.vaciados += r.vaciados ?? 0;
    }
    return resumen;
}
async function correrSaldos(origen, uid) {
    const { db, cfg, tango } = await contexto();
    if (cfg.syncCloud?.saldos === false)
        throw new https_1.HttpsError('failed-precondition', 'config/tango.syncCloud.saldos está apagado');
    const inicio = Date.now();
    const resumen = await sincronizarSaldos(db, tango, cfg);
    await db.doc('config/tango').set({
        saldosSync: { ultimaCorrida: firestore_2.FieldValue.serverTimestamp(), origen, uid: uid ?? null, duracionMs: Date.now() - inicio, resumen },
    }, { merge: true });
    v2_1.logger.info(`[tango] saldos sincronizados (${origen}) en ${Date.now() - inicio}ms: ${JSON.stringify(resumen)}`);
    return resumen;
}
// ── Programadas y callables ──────────────────────────────────────────────────
// Clientes a las 5:00 (antes que precios a las 5:30, que necesita los
// codigoTango recién vinculados). Saldos cada hora en horario de operación.
exports.syncClientesTangoConnect = (0, scheduler_1.onSchedule)({ schedule: '0 5 * * *', timeZone: TZ, secrets: [tangoApiToken], timeoutSeconds: 540, memory: '512MiB' }, async () => {
    try {
        await correrClientes('programada');
    }
    catch (e) {
        v2_1.logger.error(`[tango] sync de clientes falló: ${e.message}`);
    }
});
exports.syncSaldosTangoConnect = (0, scheduler_1.onSchedule)({ schedule: '10 6-22 * * *', timeZone: TZ, secrets: [tangoApiToken], timeoutSeconds: 540, memory: '512MiB' }, async () => {
    try {
        await correrSaldos('programada');
    }
    catch (e) {
        v2_1.logger.error(`[tango] sync de saldos falló: ${e.message}`);
    }
});
async function rolDe(uid) {
    return String((await (0, firestore_2.getFirestore)().collection('users').doc(uid).get()).data()?.rol ?? '');
}
exports.sincronizarClientesTangoAhora = (0, https_1.onCall)({ secrets: [tangoApiToken], timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'No autenticado');
    if (!ROLES_QUE_SINCRONIZAN.has(await rolDe(request.auth.uid)))
        throw new https_1.HttpsError('permission-denied', 'No tenés permiso para sincronizar clientes');
    await (0, rateLimit_1.assertRateLimit)(request.auth.uid, 'sincronizarClientesTango', 3, 300);
    return correrClientes('manual', request.auth.uid);
});
exports.sincronizarSaldosTangoAhora = (0, https_1.onCall)({ secrets: [tangoApiToken], timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'No autenticado');
    if (!ROLES_SALDOS.has(await rolDe(request.auth.uid)))
        throw new https_1.HttpsError('permission-denied', 'No tenés permiso para sincronizar saldos');
    await (0, rateLimit_1.assertRateLimit)(request.auth.uid, 'sincronizarSaldosTango', 6, 300);
    return correrSaldos('manual', request.auth.uid);
});
// ── Consultas on-demand de saldo (tango-consultas) ───────────────────────────
// La pantalla de cobro crea un doc pidiendo el saldo fresco de UN cliente. Se
// leen las Live de deudas de la empresa, se filtra por ID_GVA14 y se escribe
// `resultado` en el mismo doc; onConsultaRespondida (tangoConsultas.ts) lo
// copia después al cache saldosTango, igual que cuando respondía el bridge.
exports.onConsultaSaldoPendiente = (0, firestore_1.onDocumentCreated)({ document: 'tango-consultas/{consultaId}', secrets: [tangoApiToken], timeoutSeconds: 120, memory: '512MiB' }, async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const data = snap.data();
    if (data.tipo !== 'saldoCliente' || data.estado !== 'pendiente')
        return;
    const db = (0, firestore_2.getFirestore)();
    const marcarError = (msg) => snap.ref.update({ estado: 'error', ultimoError: msg, respondidoPor: 'cloud', actualizadoEn: firestore_2.FieldValue.serverTimestamp() });
    try {
        const cfg = ((await db.doc('config/tango').get()).data() ?? {});
        if (cfg.enabled !== true || cfg.syncCloud?.consultas === false)
            return; // la responde el bridge (o nadie)
        const tango = new client_1.TangoClient({ baseUrl: cfg.connectBaseUrl ?? CONNECT_BASE_URL_DEFAULT, token: tangoApiToken.value(), timeoutMs: 60000 });
        const empresa = data.empresa === 'rolito' ? 'rolito' : 'redonhielo';
        const idGva14 = Number(data.idGva14);
        if (!Number.isInteger(idGva14)) {
            await marcarError('idGva14 inválido');
            return;
        }
        const filas = (await filasDeuda(tango, cfg, companyDe(cfg, empresa))).filter((f) => (0, pedido_1.prop)(f, 'ID_GVA14') === idGva14);
        const comprobantes = filas.map(recortarComprobante);
        const saldoTotal = Math.round(comprobantes.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100;
        // Si mientras tanto la respondió otro (bridge todavía prendido), no pisar.
        await db.runTransaction(async (tx) => {
            const actual = (await tx.get(snap.ref)).data();
            if (!actual || actual.estado !== 'pendiente')
                return;
            tx.update(snap.ref, { estado: 'respondida', resultado: { comprobantes, saldoTotal }, ultimoError: null, respondidoPor: 'cloud', actualizadoEn: firestore_2.FieldValue.serverTimestamp() });
        });
        v2_1.logger.info(`[tango] consulta ${event.params.consultaId}: saldo de idGva14=${idGva14} (${empresa}) respondido, ${comprobantes.length} comprobantes`);
    }
    catch (e) {
        const msg = e.message;
        v2_1.logger.error(`[tango] consulta ${event.params.consultaId} falló: ${msg}`);
        await marcarError(msg).catch(() => undefined);
    }
});
//# sourceMappingURL=tangoConnectSync.js.map