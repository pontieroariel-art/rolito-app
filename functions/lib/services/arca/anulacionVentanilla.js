"use strict";
/**
 * Anulación de una factura de ventanilla con nota de crédito (2026-09-09).
 *
 * El circuito: el cajero crea `anulacionesVentanilla/{ventaId}` (pendiente),
 * un usuario con `autorizaAnulaciones` la aprueba o rechaza desde la app, y
 * acá el server emite la NC en ARCA y la refleja en tres lugares: el registro
 * `facturasArca/nc_{ventaId}` (idempotencia + reconciliación), la solicitud
 * (`estado`, `notaCredito`, `ultimoError`) y la venta (`anulacion`, que es lo
 * que miran "Mi día", el cierre de caja y tesorería para dejar de contarla).
 *
 * Lo puro (`transicionAnulacion`) está separado para testearlo sin Firestore.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.coleccionDeAnulacion = exports.rutaAnulacion = void 0;
exports.transicionAnulacion = transicionAnulacion;
exports.persistirNotaCredito = persistirNotaCredito;
exports.registrarErrorPrevio = registrarErrorPrevio;
exports.reflejarRechazoEnVenta = reflejarRechazoEnVenta;
exports.emitirNotaCreditoDeAnulacion = emitirNotaCreditoDeAnulacion;
exports.emitirNotaCreditoInterna = emitirNotaCreditoInterna;
const firestore_1 = require("firebase-admin/firestore");
const configuracion_1 = require("./configuracion");
const puertoFirebase_1 = require("./puertoFirebase");
const circuito_1 = require("./circuito");
const facturacionVenta_1 = require("./facturacionVenta");
const notaCredito_1 = require("./notaCredito");
const receptorDeVenta_1 = require("./receptorDeVenta");
const rutaAnulacion = (ventaId) => `anulacionesVentanilla/${ventaId}`;
exports.rutaAnulacion = rutaAnulacion;
const coleccionDeAnulacion = (a) => a?.coleccion === 'ventasCamion' ? 'ventasCamion' : 'ventasVentanilla';
exports.coleccionDeAnulacion = coleccionDeAnulacion;
/**
 * Qué hacer ante un cambio de la solicitud. Pura.
 *
 *   pendiente → aprobada   emitir la NC
 *   error     → aprobada   volver a intentar (re-aprobación después de un error)
 *   pendiente → rechazada  reflejar el rechazo y avisar al cajero
 *   rechazada → pendiente  el cajero volvió a pedir: avisar de nuevo
 *   todo lo demás (incluidas las escrituras del propio server) → nada
 */
function transicionAnulacion(antes, despues) {
    const a = antes?.estado;
    const d = despues?.estado;
    if (a === d)
        return null;
    if (d === 'aprobada' && (a === 'pendiente' || a === 'error'))
        return 'emitir';
    if (d === 'rechazada' && a === 'pendiente')
        return 'rechazar';
    if (d === 'pendiente' && a === 'rechazada')
        return 'resolicitar';
    return null;
}
/** Refleja el resultado de la NC en el registro, la solicitud y la venta (un solo batch). */
async function persistirNotaCredito(db, registro, coleccion = 'ventasVentanilla') {
    const ventaId = registro.ventaId;
    const nc = {
        estado: registro.estado,
        cbteTipo: registro.cbteTipo,
        puntoVenta: registro.puntoVenta,
        numero: registro.numero,
        cae: registro.cae ?? null,
        caeFchVto: registro.caeFchVto ?? null,
        ...(registro.importes ? { importes: registro.importes } : {}),
        cbtesAsoc: registro.cbtesAsoc ?? [],
    };
    const batch = db.batch();
    batch.set(db.doc((0, facturacionVenta_1.rutaNotaCredito)(ventaId)), {
        ...registro,
        tipo: 'nota_credito',
        coleccion,
        actualizadoEn: firestore_1.FieldValue.serverTimestamp(),
        ...(registro.estado === 'rechazada' ? { avisadoEn: null } : {}),
    }, { merge: true });
    if (registro.estado === 'emitida') {
        batch.set(db.doc((0, exports.rutaAnulacion)(ventaId)), {
            estado: 'emitida', notaCredito: nc, ultimoError: null, actualizadoEn: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        batch.set(db.doc(`${coleccion}/${ventaId}`), {
            anulacion: { estado: 'anulada', solicitudId: ventaId, notaCredito: nc },
        }, { merge: true });
    }
    else if (registro.estado === 'incierta') {
        // Número reservado, ARCA no contestó: la solicitud sigue 'aprobada' hasta
        // que la reconciliación averigüe qué pasó. La venta no se anula todavía.
        batch.set(db.doc((0, exports.rutaAnulacion)(ventaId)), {
            notaCredito: nc, ultimoError: registro.motivo ?? null, actualizadoEn: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        batch.set(db.doc(`${coleccion}/${ventaId}`), {
            anulacion: { estado: 'aprobada', solicitudId: ventaId },
        }, { merge: true });
    }
    else {
        batch.set(db.doc((0, exports.rutaAnulacion)(ventaId)), {
            estado: 'error', notaCredito: nc, ultimoError: registro.motivo ?? 'ARCA rechazó la nota de crédito',
            actualizadoEn: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        batch.set(db.doc(`${coleccion}/${ventaId}`), {
            anulacion: { estado: 'error', solicitudId: ventaId },
        }, { merge: true });
    }
    await batch.commit();
}
/** La solicitud quedó en error antes de llegar a ARCA (sin número): que la reconciliación reintente. */
async function registrarErrorPrevio(db, ventaId, motivo, coleccion = 'ventasVentanilla') {
    const batch = db.batch();
    batch.set(db.doc((0, facturacionVenta_1.rutaNotaCredito)(ventaId)), {
        ventaId, anulacionId: ventaId, tipo: 'nota_credito', coleccion,
        estado: 'pendiente', motivo, actualizadoEn: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.doc((0, exports.rutaAnulacion)(ventaId)), { ultimoError: motivo, actualizadoEn: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
}
/** El autorizante rechazó: la venta vuelve a contar y el cajero puede volver a pedir. */
async function reflejarRechazoEnVenta(db, ventaId, coleccion = 'ventasVentanilla') {
    await db.doc(`${coleccion}/${ventaId}`).set({ anulacion: { estado: 'rechazada', solicitudId: ventaId } }, { merge: true });
}
/**
 * Emite (o retoma) la nota de crédito de una anulación aprobada.
 *
 * Devuelve null si no corresponde (la solicitud no está aprobada, la venta no
 * la factura la app o ya no existe). Si la factura original no está emitida
 * (incierta/rechazada) deja la solicitud en `error` con el motivo y devuelve
 * null: primero hay que resolver la factura (la reconciliación lo hace) y
 * después volver a aprobar. Los errores previos a la reserva de número se
 * relanzan: el que llama decide si deja el registro 'pendiente'.
 */
async function emitirNotaCreditoDeAnulacion(db, ventaId) {
    const anulacion = (await db.doc((0, exports.rutaAnulacion)(ventaId)).get()).data();
    if (!anulacion || anulacion.estado !== 'aprobada')
        return null;
    const coleccion = (0, exports.coleccionDeAnulacion)(anulacion);
    const venta = (await db.doc(`${coleccion}/${ventaId}`).get()).data();
    if (!venta)
        return null;
    const documento = (0, circuito_1.documentoDeVenta)(venta.canal, venta.formaPago, venta.total);
    // Promo (factura X, sin ARCA): nota de crédito interna numerada por la app (2026-09-11).
    if (documento === 'no_oficial')
        return emitirNotaCreditoInterna(db, ventaId, coleccion, venta);
    if (documento !== 'factura_arca')
        return null;
    const espejo = venta.factura;
    if (!espejo || espejo.estado !== 'emitida' || !espejo.cae) {
        const motivo = `La factura original no está emitida (estado ${espejo?.estado ?? 'sin factura'}); resolvela antes de anular`;
        await db.doc((0, exports.rutaAnulacion)(ventaId)).set({ estado: 'error', ultimoError: motivo, actualizadoEn: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
        await db.doc(`${coleccion}/${ventaId}`).set({ anulacion: { estado: 'error', solicitudId: ventaId } }, { merge: true });
        return null;
    }
    const registroFactura = (await db.doc((0, facturacionVenta_1.rutaFactura)(ventaId)).get()).data();
    const importes = (registroFactura?.importes ?? espejo.importes);
    if (!importes)
        throw new Error(`La factura de la venta ${ventaId} no tiene importes guardados: no se puede armar la NC`);
    const factura = {
        puntoVenta: Number(registroFactura?.puntoVenta ?? espejo.puntoVenta),
        cbteTipo: Number(registroFactura?.cbteTipo ?? espejo.cbteTipo),
        numero: Number(registroFactura?.numero ?? espejo.numero),
        importes,
        ...(registroFactura?.detalle ? { detalle: registroFactura.detalle } : {}),
    };
    const config = await (0, configuracion_1.leerConfigParaEmitir)((0, puertoFirebase_1.comoDb)(db));
    const { receptor } = await (0, receptorDeVenta_1.receptorDeVenta)(db, ventaId, venta, coleccion);
    const arca = await (0, puertoFirebase_1.puertoArca)(db, config);
    return (0, notaCredito_1.emitirNotaCreditoTotal)({
        db: (0, puertoFirebase_1.comoDb)(db),
        arca,
        config,
        ventaId,
        anulacionId: ventaId,
        factura,
        receptor,
        leer: async () => (await db.doc((0, facturacionVenta_1.rutaNotaCredito)(ventaId)).get()).data(),
        guardar: async (r) => { await persistirNotaCredito(db, r, coleccion); },
    });
}
/** yyyy-MM-dd del día calendario argentino. */
const diaArgentino = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
/**
 * Nota de crédito interna para una factura X de promo (2026-09-11): sin ARCA.
 * Exige que Tango ya tenga la factura (`venta.tango.facturaNumero`), porque la
 * NC de Rolito la referencia; toma el número del contador
 * `config/numeracionInterna_notaCreditoX` en una transacción y deja la
 * solicitud 'emitida' y la venta 'anulada'. Sin contador → 'error' con el
 * motivo (hay que crearlo con configurar-ventas-tango --numeracion notaCreditoX=PV).
 */
async function emitirNotaCreditoInterna(db, ventaId, coleccion, venta) {
    const tango = venta.tango;
    const fallar = async (motivo) => {
        await db.doc((0, exports.rutaAnulacion)(ventaId)).set({ estado: 'error', ultimoError: motivo, actualizadoEn: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
        await db.doc(`${coleccion}/${ventaId}`).set({ anulacion: { estado: 'error', solicitudId: ventaId } }, { merge: true });
        return null;
    };
    if (tango?.estado !== 'confirmado' || !tango.facturaNumero) {
        return fallar(`La factura de promo todavía no está registrada en Tango (estado ${tango?.estado ?? 'sin enviar'}); cuando entre, volvé a aprobar la anulación`);
    }
    const counterRef = db.doc('config/numeracionInterna_notaCreditoX');
    let nc;
    try {
        nc = await db.runTransaction(async (tx) => {
            const c = (await tx.get(counterRef)).data();
            if (!c || !Number.isInteger(c.next) || !Number.isInteger(Number(c.puntoVenta)))
                throw new Error('falta config/numeracionInterna_notaCreditoX { next, puntoVenta }');
            if (c.ultimo != null && Number(c.next) > Number(c.ultimo))
                throw new Error('el talonario de notas de crédito X se agotó');
            tx.update(counterRef, { next: Number(c.next) + 1 });
            return { tipo: 'notaCreditoX', puntoVenta: Number(c.puntoVenta), numero: Number(c.next), fecha: diaArgentino(new Date()) };
        });
    }
    catch (e) {
        return fallar(`No se pudo numerar la nota de crédito X: ${e.message}`);
    }
    const batch = db.batch();
    batch.set(db.doc((0, exports.rutaAnulacion)(ventaId)), { estado: 'emitida', notaCreditoInterna: nc, ultimoError: null, actualizadoEn: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
    batch.set(db.doc(`${coleccion}/${ventaId}`), { anulacion: { estado: 'anulada', solicitudId: ventaId, notaCreditoInterna: nc } }, { merge: true });
    await batch.commit();
    return { estado: 'emitida', interna: true, puntoVenta: nc.puntoVenta, numero: nc.numero };
}
//# sourceMappingURL=anulacionVentanilla.js.map