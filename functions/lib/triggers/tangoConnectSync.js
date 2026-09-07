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
exports.filasClientes = filasClientes;
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
const empresas_1 = require("../services/tango/empresas");
const clientes_1 = require("../services/tango/clientes");
const auth_1 = require("firebase-admin/auth");
const rateLimit_1 = require("../rateLimit");
const tangoApiToken = (0, params_1.defineSecret)('TANGO_API_TOKEN');
const CONNECT_BASE_URL_DEFAULT = 'https://001174-003.connect.axoft.com';
const TZ = 'America/Argentina/Buenos_Aires';
const ROLES_QUE_SINCRONIZAN = new Set(['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion']);
const ROLES_SALDOS = new Set([...ROLES_QUE_SINCRONIZAN, 'supervisor']);
// Consultas Live de composición de saldos. Mismos procesos que usaba el
// bridge; se pueden pisar desde config/tango.saldos (y por empresa en
// config/tango.saldos.porEmpresa.<empresa>).
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
        ...(typeof (0, pedido_1.prop)(c, 'HABILITADO') === 'boolean' ? { habilitado: (0, pedido_1.prop)(c, 'HABILITADO') } : {}),
    };
}
function resumenClientesVacio() {
    return {
        recibidos: 0, lotes: 0, actualizados: 0, matchedByIdGva14: 0, matchedByCuit: 0, matchedByCodigo: 0,
        newlyLinkedCodigoTango: 0, codigosSecundarios: 0, skippedNoMatch: 0, skippedAmbiguousCuit: 0, emailsActualizados: 0, emailsConError: 0, errores: [],
    };
}
function sumarResumenClientes(into, r) {
    into.lotes++;
    into.actualizados += r.actualizados ?? 0;
    into.matchedByIdGva14 += r.matchedByIdGva14 ?? 0;
    into.matchedByCuit += r.matchedByCuit ?? 0;
    into.matchedByCodigo += r.matchedByCodigo ?? 0;
    into.newlyLinkedCodigoTango += r.newlyLinkedCodigoTango ?? 0;
    into.codigosSecundarios += r.codigosSecundarios ?? 0;
    into.skippedNoMatch += r.skippedNoMatch ?? 0;
    into.skippedAmbiguousCuit += r.skippedAmbiguousCuit ?? 0;
    into.emailsActualizados += r.emailsActualizados ?? 0;
    into.emailsConError += r.emailsConError ?? 0;
    if (r.errores?.length && into.errores.length < 50)
        into.errores.push(...r.errores.slice(0, 50 - into.errores.length));
}
/** Filas de clientes de una empresa, ya recortadas. */
async function filasClientes(tango, company) {
    const filas = await tango.getAll(company, client_1.PROCESOS.clientes, 200);
    return filas.map(recortarCliente).filter((r) => Number.isInteger(r.idGva14) && r.codGva14);
}
/**
 * Padrón de las DOS empresas (2026-09-06). Redonhielo primero (manda la ficha),
 * Rolito después (solo vincula identidad). Si una empresa falla, la otra sigue
 * y el error queda en el resumen, como en la sync de precios.
 */
async function sincronizarClientes(db, tango, cfg) {
    const indice = await (0, tangoSync_1.indiceUsuariosClientes)(db);
    const resumen = { ...resumenClientesVacio(), empresas: {} };
    const sinCuenta = [];
    // Por empresa: uid → apareció habilitada (true) o solo inhabilitada (false).
    const vistos = { redonhielo: new Map(), rolito: new Map() };
    const corridaOk = {};
    for (const empresa of empresas_1.EMPRESAS) {
        const re = resumenClientesVacio();
        resumen.empresas[empresa] = re;
        try {
            const company = companyDe(cfg, empresa);
            re.company = company;
            const rows = await filasClientes(tango, company);
            re.recibidos = rows.length;
            for (const lote of chunk(rows, 300)) {
                const r = await (0, tangoSync_1.procesarLoteClientesTango)(db, lote, { dryRun: false, empresa, indice });
                sumarResumenClientes(re, r);
                for (const f of r.sinCuenta ?? [])
                    sinCuenta.push({ empresa, fila: f });
                for (const v of r.vistos ?? [])
                    vistos[empresa].set(v.uid, (vistos[empresa].get(v.uid) ?? false) || v.habilitado);
            }
            corridaOk[empresa] = (0, clientes_1.corridaConfiable)(rows.length, cfg.clientesSync?.resumen?.empresas?.[empresa]?.recibidos);
        }
        catch (e) {
            corridaOk[empresa] = false;
            re.errores.push({ empresa, motivo: e.message });
            v2_1.logger.error(`[tango] sync de clientes de ${empresa} falló: ${e.message}`);
        }
        // Totales (compatibilidad con el panel viejo): suma de las dos empresas.
        for (const k of Object.keys(re)) {
            if (k === 'errores')
                resumen.errores.push(...re.errores);
            else if (k !== 'company')
                resumen[k] += re[k];
        }
    }
    // Altas y bajas no pueden tirar abajo la corrida: si fallan, queda el
    // error en el resumen y el resto (fichas ya actualizadas) se registra igual.
    try {
        if (cfg.altas?.enabled === true)
            resumen.altas = await encolarAltas(db, sinCuenta);
    }
    catch (e) {
        resumen.errores.push({ paso: 'altas', motivo: e.message });
        v2_1.logger.error(`[tango] encolar altas falló: ${e.message}`);
    }
    try {
        resumen.bajas = await aplicarBajas(db, cfg, indice.perfilPorUid, vistos, corridaOk);
    }
    catch (e) {
        resumen.errores.push({ paso: 'bajas', motivo: e.message });
        v2_1.logger.error(`[tango] bajas falló: ${e.message}`);
    }
    return resumen;
}
// ── Altas: encolar candidatos (los crea tangoAltas.ts) ──────────────────────
async function encolarAltas(db, sinCuenta) {
    const { candidatos, descartados } = (0, clientes_1.candidatosAlta)(sinCuenta);
    const porMotivo = {};
    for (const d of descartados)
        porMotivo[d.motivo] = (porMotivo[d.motivo] ?? 0) + 1;
    const out = { candidatos: candidatos.length, encolados: 0, yaEncolados: 0, descartados: descartados.length, porMotivo, ejemplosDescartados: descartados.filter((d) => d.motivo === 'cuit_invalido').slice(0, 30) };
    // Una sola lectura de la cola (son miles de CUIT: leerlos de a uno superaba
    // el tope de 9 min de la function). Los que ya están en un estado final
    // (creada / existia / error) no se re-encolan solos.
    const enCola = new Map();
    for (const d of (await db.collection('tango-altas').select('estado').get()).docs)
        enCola.set(d.id, String(d.data().estado ?? ''));
    let batch = db.batch(), ops = 0;
    for (const c of candidatos) {
        const estadoActual = enCola.get(c.clave);
        if (estadoActual && estadoActual !== 'pendiente') {
            out.yaEncolados++;
            continue;
        }
        if (estadoActual)
            out.yaEncolados++;
        else
            out.encolados++;
        // JSON round-trip: las filas recortadas traen campos undefined (str() de
        // recortarCliente) y Firestore los rechaza.
        batch.set(db.doc(`tango-altas/${c.clave}`), { cuit: c.cuit, clave: c.clave, ...(c.sinCuit ? { sinCuit: true } : {}), filas: JSON.parse(JSON.stringify(c.filas)), estado: 'pendiente', razonSocial: c.filas[0].fila.razonSocial ?? '', actualizadoEn: firestore_2.FieldValue.serverTimestamp(), ...(estadoActual ? {} : { creadoEn: firestore_2.FieldValue.serverTimestamp() }) }, { merge: true });
        if (++ops >= 400) {
            await batch.commit();
            batch = db.batch();
            ops = 0;
        }
    }
    if (ops)
        await batch.commit();
    return out;
}
// ── Bajas / reactivaciones ──────────────────────────────────────────────────
// Solo cuentas con identidad Tango. Baja = estado 'inactivo' + Auth
// deshabilitado (la sesión muere); nunca se borra nada. Con circuit breaker
// por empresa (corridaOk) y tope por corrida.
async function aplicarBajas(db, cfg, perfilPorUid, vistos, corridaOk) {
    const out = { enabled: cfg.bajas?.enabled === true, evaluadas: 0, bajas: 0, reactivadas: 0, corridaConfiable: corridaOk, topeAlcanzado: false, ejemplos: [] };
    const tope = cfg.bajas?.maxPorCorrida ?? 500;
    const auth = (0, auth_1.getAuth)();
    for (const [uid, perfil] of perfilPorUid) {
        const ids = (0, empresas_1.tangoIdsDe)(perfil);
        const estado = { vinculada: {}, habilitada: {}, corridaOk };
        for (const e of empresas_1.EMPRESAS) {
            if (!ids[e]?.length)
                continue;
            estado.vinculada[e] = true;
            if (vistos[e].has(uid))
                estado.habilitada[e] = vistos[e].get(uid);
        }
        if (!Object.keys(estado.vinculada).length)
            continue;
        out.evaluadas++;
        const decision = (0, clientes_1.decidirBaja)(estado, perfil);
        if (decision.accion === 'nada')
            continue;
        if (out.ejemplos.length < 30)
            out.ejemplos.push({ uid, razonSocial: String(perfil.razonSocial ?? perfil.nombre ?? ''), accion: decision.accion, ...(decision.accion === 'baja' ? { motivo: decision.motivo } : {}) });
        if (!out.enabled) {
            if (decision.accion === 'baja')
                out.bajas++;
            else
                out.reactivadas++;
            continue;
        } // dry-run: solo contar
        if (decision.accion === 'baja') {
            if (out.bajas >= tope) {
                out.topeAlcanzado = true;
                continue;
            }
            await db.doc(`users/${uid}`).update({ estado: 'inactivo', bajaTango: { fecha: firestore_2.FieldValue.serverTimestamp(), motivo: decision.motivo } });
            await auth.updateUser(uid, { disabled: true }).catch((e) => v2_1.logger.warn(`[tango] baja ${uid}: no se pudo deshabilitar en Auth (${e.message})`));
            await auth.revokeRefreshTokens(uid).catch(() => undefined);
            out.bajas++;
        }
        else {
            await db.doc(`users/${uid}`).update({ estado: 'activo', bajaTango: firestore_2.FieldValue.delete() });
            await auth.updateUser(uid, { disabled: false }).catch((e) => v2_1.logger.warn(`[tango] reactivar ${uid}: no se pudo habilitar en Auth (${e.message})`));
            out.reactivadas++;
        }
    }
    return out;
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
    v2_1.logger.info(`[tango] clientes sincronizados (${origen}) en ${Date.now() - inicio}ms: ${JSON.stringify({ ...resumen, empresas: undefined, errores: resumen.errores.length, altas: resumen.altas && { ...resumen.altas, ejemplosDescartados: undefined }, bajas: resumen.bajas && { ...resumen.bajas, ejemplos: undefined } })}`);
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
async function filasDeuda(tango, cfg, company, empresa = 'redonhielo') {
    const porEmpresa = cfg.saldos?.porEmpresa?.[empresa] ?? {};
    const desde = porEmpresa.fromDate ?? cfg.saldos?.fromDate ?? FROM_DATE_DEFAULT;
    const hastaDate = new Date();
    hastaDate.setFullYear(hastaDate.getFullYear() + 5); // "a vencer" incluye vencimientos futuros
    const hasta = ddMMyyyy(hastaDate);
    const vencidas = porEmpresa.procesoDeudasVencidas ?? cfg.saldos?.procesoDeudasVencidas ?? PROCESO_DEUDAS_VENCIDAS_DEFAULT;
    const aVencer = porEmpresa.procesoDeudasAVencer ?? cfg.saldos?.procesoDeudasAVencer ?? PROCESO_DEUDAS_A_VENCER_DEFAULT;
    const filas = await tango.live(company, vencidas, desde, hasta);
    filas.push(...await tango.live(company, aVencer, desde, hasta));
    return filas;
}
/**
 * Deuda de las DOS empresas (2026-09-06): cada una se lee y se escribe por
 * separado en su rama de saldosTango/{uid}, con su propio runId de vaciado. Los
 * varios códigos de un mismo CUIT van juntos en el mismo lote (se agrupan por
 * cuenta antes de partir), así ningún lote pisa lo que escribió el anterior.
 */
async function sincronizarSaldos(db, tango, cfg) {
    const indice = await (0, tangoSaldos_1.indiceClientesTango)(db);
    const descuentos = await (0, tangoSaldos_1.descuentosPendientes)(db);
    const resumen = { filas: 0, clientesConDeuda: 0, lotes: 0, actualizados: 0, skippedNoMatch: 0, vaciados: 0, empresas: {} };
    for (const empresa of empresas_1.EMPRESAS) {
        const re = { filas: 0, clientesConDeuda: 0, lotes: 0, actualizados: 0, skippedNoMatch: 0, vaciados: 0 };
        resumen.empresas[empresa] = re;
        try {
            const company = companyDe(cfg, empresa);
            re.company = company;
            const filas = await filasDeuda(tango, cfg, company, empresa);
            const porCliente = new Map();
            for (const f of filas) {
                const idGva14 = (0, pedido_1.prop)(f, 'ID_GVA14');
                if (typeof idGva14 !== 'number')
                    continue;
                if (!porCliente.has(idGva14)) {
                    const { codigo, nombre } = parseCliente((0, pedido_1.prop)(f, 'CLIENTE'));
                    porCliente.set(idGva14, { idGva14, codGva14: codigo || undefined, razonSocial: nombre || undefined, empresa, comprobantes: [] });
                }
                porCliente.get(idGva14).comprobantes.push(recortarComprobante(f));
            }
            // Agrupar por cuenta de la app para que los códigos de un mismo CUIT
            // caigan en el mismo lote; los no vinculados van al final (skippedNoMatch).
            const grupos = new Map();
            for (const row of porCliente.values()) {
                const clave = indice[empresa].get(row.idGva14)?.uid ?? `?${row.idGva14}`;
                if (!grupos.has(clave))
                    grupos.set(clave, []);
                grupos.get(clave).push(row);
            }
            const lotes = [...grupos.values()].reduce((acc, g) => {
                if (!acc.length || acc[acc.length - 1].length >= 100)
                    acc.push([]);
                acc[acc.length - 1].push(...g);
                return acc;
            }, []);
            // runId identifica la corrida completa de ESTA empresa: al llegar el
            // último lote, toda rama de esta empresa que no fue tocada se vacía.
            const runId = `${empresa}:${new Date().toISOString()}`;
            re.filas = filas.length;
            re.clientesConDeuda = porCliente.size;
            if (lotes.length === 0)
                lotes.push([]); // nadie debe nada: igual hay que vaciar el cache viejo
            for (const [i, lote] of lotes.entries()) {
                const r = await (0, tangoSaldos_1.procesarLoteSaldos)(db, lote, { dryRun: false, runId, esUltimoLote: i === lotes.length - 1, empresa, indice, descuentos });
                re.lotes++;
                re.actualizados += r.actualizados ?? 0;
                re.skippedNoMatch += r.skippedNoMatch ?? 0;
                re.vaciados += r.vaciados ?? 0;
            }
        }
        catch (e) {
            re.error = e.message;
            v2_1.logger.error(`[tango] sync de saldos de ${empresa} falló: ${re.error}`);
        }
        resumen.filas += re.filas;
        resumen.clientesConDeuda += re.clientesConDeuda;
        resumen.lotes += re.lotes;
        resumen.actualizados += re.actualizados;
        resumen.skippedNoMatch += re.skippedNoMatch;
        resumen.vaciados += re.vaciados;
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
        // Varios códigos del mismo CUIT: la consulta puede traer más de un ID_GVA14.
        const ids = new Set([idGva14, ...(Array.isArray(data.idsGva14) ? data.idsGva14.map(Number).filter(Number.isInteger) : [])]);
        const filas = (await filasDeuda(tango, cfg, companyDe(cfg, empresa), empresa)).filter((f) => ids.has((0, pedido_1.prop)(f, 'ID_GVA14')));
        const comprobantes = filas.map((f) => ({ ...recortarComprobante(f), codigoTango: parseCliente((0, pedido_1.prop)(f, 'CLIENTE')).codigo }));
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