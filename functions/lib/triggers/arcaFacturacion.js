"use strict";
/**
 * Facturación electrónica de las ventas de contado del camión.
 *
 * Acá vive el pegamento: leer la venta y el cliente, resolver la percepción de
 * IIBB, armar el puerto hacia ARCA y delegar en `facturarVenta`, que es quien
 * garantiza que una venta produzca a lo sumo una factura.
 *
 * Toda la lógica con reglas propias (fiscal, numeración, idempotencia) vive en
 * `services/arca/` y está testeada sin red. Este archivo es deliberadamente
 * flaco: si crece, algo se está poniendo en el lugar equivocado.
 *
 * Ver docs/arca/FACTURACION_ELECTRONICA.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconciliarFacturasArca = exports.onVentaContadoFacturar = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const params_1 = require("firebase-functions/params");
const firestore_2 = require("firebase-admin/firestore");
const configuracion_1 = require("../services/arca/configuracion");
const ticketCache_1 = require("../services/arca/ticketCache");
const wsaa_1 = require("../services/arca/wsaa");
const wsfev1_1 = require("../services/arca/wsfev1");
const emision_1 = require("../services/arca/emision");
const facturacionVenta_1 = require("../services/arca/facturacionVenta");
const circuito_1 = require("../services/arca/circuito");
const TZ = 'America/Argentina/Buenos_Aires';
// El certificado y su clave viven en secrets, nunca en el repo ni en Firestore:
// con ellos se puede emitir comprobantes en nombre de la empresa.
const arcaCert = (0, params_1.defineSecret)('ARCA_CERT_PEM');
const arcaKey = (0, params_1.defineSecret)('ARCA_KEY_PEM');
/** Firestore real, con la forma mínima que esperan los servicios. */
function comoDb(db) {
    return {
        doc: (path) => db.doc(path),
        runTransaction: (fn) => db.runTransaction(fn),
    };
}
/** Arma el puerto hacia ARCA: autentica (con cache) y expone las dos operaciones. */
async function puertoArca(db, config) {
    // El certificado (secret) y el ambiente (config/arca) se cambian por
    // separado, y el de homologación está a nombre de otro CUIT. Cruzados, ARCA
    // devuelve un 601 que no dice cuál de las dos puntas está mal.
    (0, wsaa_1.verificarCertificadoCoincide)(arcaCert.value(), config.cuit);
    const ta = await (0, ticketCache_1.obtenerTicketAcceso)({
        db: comoDb(db),
        cuit: config.cuit,
        ambiente: config.ambiente,
        certificadoPem: arcaCert.value(),
        clavePrivadaPem: arcaKey.value(),
    });
    const cfg = {
        ambiente: config.ambiente,
        credenciales: { token: ta.token, sign: ta.sign, cuit: config.cuit },
    };
    return {
        solicitarCae: (ptoVta, cbteTipo, detalle) => (0, wsfev1_1.feCaeSolicitar)(cfg, ptoVta, cbteTipo, detalle),
        consultarComprobante: (ptoVta, cbteTipo, numero) => (0, wsfev1_1.feCompConsultar)(cfg, ptoVta, cbteTipo, numero),
    };
}
/**
 * Percepción de IIBB del cliente.
 *
 * Se espera en `users/{uid}.percepcionIIBB` con la alícuota del padrón de AGIP y
 * su período de vigencia. Devuelve undefined si el cliente no está en el padrón:
 * eso significa "no corresponde percibirle", no "faltan datos".
 *
 * OJO: quien complete este campo (el sync desde Tango) **tiene que escribir la
 * vigencia**. Sin vigencia no se puede distinguir una alícuota del mes en curso
 * de una del mes pasado, y usar la vieja factura mal sin que nada falle.
 */
function percepcionDe(perfil, config) {
    const p = perfil.percepcionIIBB;
    if (!p)
        return undefined;
    const alicuota = Number(p.alicuota);
    if (!Number.isFinite(alicuota) || alicuota <= 0)
        return undefined;
    const desde = p.vigenciaDesde?.toDate?.();
    const hasta = p.vigenciaHasta?.toDate?.();
    if (!desde || !hasta) {
        throw new Error('El cliente tiene alícuota de percepción de IIBB pero sin período de vigencia. ' +
            'No se puede saber si el padrón está al día, así que no se factura.');
    }
    return {
        alicuota,
        tributoId: config.tributoIdPercepcionIIBB,
        descripcion: 'Percepción IIBB CABA',
        vigenciaDesde: desde,
        vigenciaHasta: hasta,
    };
}
function itemsDe(venta) {
    const items = (venta.items ?? []);
    return items.map((i) => ({
        descripcion: String(i.nombre ?? ''),
        cantidad: Number(i.cantidad),
        precioUnitario: Number(i.precioUnitario),
    }));
}
/** Guarda el estado de la factura y lo refleja en la venta. */
async function persistir(db, registro) {
    const batch = db.batch();
    batch.set(db.doc((0, facturacionVenta_1.rutaFactura)(registro.ventaId)), { ...registro, actualizadoEn: firestore_2.FieldValue.serverTimestamp() }, { merge: true });
    // Espejo en la venta, para que la pantalla del chofer y los listados no
    // tengan que hacer un join. Lleva todo lo que necesita el comprobante
    // impreso: el tipo (define si es A o B), la fecha y los importes TAL COMO se
    // le informaron a ARCA. Recalcularlos en el front arriesgaría que el papel
    // no coincida con lo declarado.
    batch.set(db.doc(`ventasCamion/${registro.ventaId}`), {
        factura: {
            estado: registro.estado,
            numero: registro.numero,
            puntoVenta: registro.puntoVenta,
            cbteTipo: registro.cbteTipo,
            cae: registro.cae ?? null,
            caeFchVto: registro.caeFchVto ?? null,
            ...(registro.importes ? { importes: registro.importes } : {}),
        },
    }, { merge: true });
    await batch.commit();
}
/**
 * Factura una venta ya conocida. Compartido por el trigger y la reconciliación.
 */
async function facturar(db, ventaId) {
    const config = await (0, configuracion_1.leerConfigParaEmitir)(comoDb(db));
    const ventaSnap = await db.doc(`ventasCamion/${ventaId}`).get();
    const venta = ventaSnap.data();
    if (!venta)
        return null;
    const documento = (0, circuito_1.documentoDeVenta)(venta.canal, venta.formaPago);
    if (documento !== 'factura_arca') {
        // Promo (Rolito) y cuenta corriente no las factura la app. La de cuenta
        // corriente sale por remito y la factura la oficina desde Tango: emitirla
        // acá también sería facturar dos veces la misma venta.
        if (documento === null) {
            console.warn(`[arca] la venta ${ventaId} no dice cómo se cobró ` +
                `(canal=${String(venta.canal)}, formaPago=${String(venta.formaPago)}); no se factura`);
        }
        return null;
    }
    const clienteId = String(venta.clienteId ?? '');
    const perfil = clienteId ? (await db.doc(`users/${clienteId}`).get()).data() : undefined;
    if (!perfil)
        throw new Error(`La venta ${ventaId} no tiene un cliente resoluble`);
    const arca = await puertoArca(db, config);
    return (0, facturacionVenta_1.facturarVenta)({
        db: comoDb(db),
        arca,
        config,
        ventaId,
        datos: {
            receptor: {
                razonSocial: String(perfil.razonSocial ?? ''),
                cuit: String(perfil.cuit ?? ''),
                categoriaIvaTango: String(perfil.categoriaIvaTango ?? ''),
            },
            items: itemsDe(venta),
            fechaVenta: venta.fecha?.toDate?.() ?? new Date(),
        },
        percepcionIIBB: percepcionDe(perfil, config),
        leer: async () => (await db.doc((0, facturacionVenta_1.rutaFactura)(ventaId)).get()).data(),
        guardar: async (r) => { await persistir(db, r); },
    });
}
/**
 * Venta de contado nueva → factura electrónica.
 *
 * Los errores se registran pero NO se relanzan: si se relanzaran, Cloud
 * Functions reintentaría el trigger, y cada reintento pasaría otra vez por
 * `facturarVenta`. Eso es seguro (está diseñado para ser idempotente) pero
 * inútil si la causa es permanente — un cliente sin CUIT no se arregla
 * reintentando. Lo que sí reintenta es la reconciliación, que corre con
 * criterio.
 */
exports.onVentaContadoFacturar = (0, firestore_1.onDocumentCreated)({ document: 'ventasCamion/{ventaId}', secrets: [arcaCert, arcaKey] }, async (event) => {
    const venta = event.data?.data();
    // Filtro barato antes de tocar secrets y red; `facturar` vuelve a decidir
    // sobre la venta releída, que es la palabra final.
    if (!venta || (0, circuito_1.documentoDeVenta)(venta.canal, venta.formaPago) !== 'factura_arca')
        return;
    const db = (0, firestore_2.getFirestore)();
    const ventaId = event.params.ventaId;
    try {
        await facturar(db, ventaId);
    }
    catch (e) {
        const motivo = e.message;
        console.error(`[arca] no se pudo facturar la venta ${ventaId}: ${motivo}`);
        await db.doc((0, facturacionVenta_1.rutaFactura)(ventaId)).set({ ventaId, estado: 'pendiente', motivo, actualizadoEn: firestore_2.FieldValue.serverTimestamp() }, { merge: true });
    }
});
/**
 * Reconciliación: resuelve lo que quedó a medias.
 *
 * Dos casos distintos:
 *
 *   `incierta`  → se pidió el CAE y no sabemos si salió. Solo se puede
 *                 preguntar (`resolverIncierto`); nunca reintentar la emisión.
 *   `pendiente` → ni siquiera se llegó a intentar (faltaba configuración, el
 *                 cliente no era facturable, ARCA estaba caído). Acá sí se
 *                 reintenta de cero.
 *
 * Corre seguido porque una factura sin resolver bloquea la ventana de 5 días de
 * ARCA: pasada esa ventana la venta ya no se puede facturar con su fecha real.
 */
exports.reconciliarFacturasArca = (0, scheduler_1.onSchedule)({ schedule: '15 * * * *', timeZone: TZ, secrets: [arcaCert, arcaKey] }, async () => {
    const db = (0, firestore_2.getFirestore)();
    const pendientes = await db
        .collection('facturasArca')
        .where('estado', 'in', ['incierta', 'pendiente'])
        .limit(50)
        .get();
    if (pendientes.empty)
        return;
    let config;
    try {
        config = await (0, configuracion_1.leerConfigParaEmitir)(comoDb(db));
    }
    catch (e) {
        console.error(`[arca] reconciliación sin configuración utilizable: ${e.message}`);
        return;
    }
    const arca = await puertoArca(db, config);
    for (const docSnap of pendientes.docs) {
        const f = docSnap.data();
        const ventaId = docSnap.id;
        try {
            if (f.estado === 'incierta' && typeof f.numero === 'number' && typeof f.cbteTipo === 'number') {
                const r = await (0, emision_1.resolverIncierto)(comoDb(db), arca, config.puntoVenta, f.cbteTipo, f.numero);
                await persistir(db, {
                    ventaId,
                    estado: r.estado === 'emitido' ? 'emitida' : 'rechazada',
                    puntoVenta: config.puntoVenta,
                    cbteTipo: r.cbteTipo,
                    numero: r.numero,
                    cae: r.estado === 'emitido' ? r.cae : null,
                    caeFchVto: r.estado === 'emitido' ? r.caeFchVto : null,
                    motivo: r.estado === 'rechazado' ? r.motivo : null,
                });
            }
            else if ((await facturar(db, ventaId)) === null) {
                // La venta no la factura la app (promo, cuenta corriente) o ya no
                // existe. Sin este cierre el registro quedaría 'pendiente' para
                // siempre, reintentándose cada hora sin que nada cambie nunca.
                await docSnap.ref.set({
                    estado: 'no_corresponde',
                    motivo: 'la app no factura esta venta: es promo, es de cuenta corriente (la factura la oficina desde el remito) o la venta ya no existe',
                    actualizadoEn: firestore_2.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
        }
        catch (e) {
            // Un fallo acá no debe frenar al resto de la tanda.
            console.error(`[arca] reconciliación de ${ventaId} falló: ${e.message}`);
        }
    }
});
//# sourceMappingURL=arcaFacturacion.js.map