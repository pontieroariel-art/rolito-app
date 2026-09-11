"use strict";
/**
 * Anulación de una venta de un día YA CERRADO (2026-09-11, decisión de Ariel:
 * la pide facturación desde Comprobantes de clientes; la liquidación del
 * repartidor o el cierre de caja NO se reabren, quedan con una nota).
 *
 * Cuando una venta pasa a `anulacion.estado = 'anulada'` (NC de ARCA, NC X de
 * promo o remito anulado) y el cierre de ese día ya existe, se le agrega una
 * entrada a `anulacionesPosteriores` del cierre:
 *   - venta del camión → `liquidaciones/{fechaVenta}_{choferId}`
 *   - venta de ventanilla → `rendiciones/{fechaVenta}_{cajaId}`
 * Los importes del cierre no se tocan (ya se rindió esa plata); la nota es
 * para que tesorería y la oficina sepan que ese comprobante ya no vale.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.diaArgentino = void 0;
exports.idDelCierre = idDelCierre;
exports.entradaDeAnulacion = entradaDeAnulacion;
exports.anotarAnulacionPosterior = anotarAnulacionPosterior;
const firestore_1 = require("firebase-admin/firestore");
const nro = (pv, n) => `${String(pv ?? 0).padStart(5, '0')}-${String(n ?? 0).padStart(8, '0')}`;
const diaArgentino = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
exports.diaArgentino = diaArgentino;
/** Id del cierre que cubre esa venta, o null si la venta no alcanza para saberlo. Pura. */
function idDelCierre(coleccion, venta) {
    const fecha = venta.anulacion?.fechaVenta ?? (venta.fecha?.toDate ? (0, exports.diaArgentino)(venta.fecha.toDate()) : null);
    const sujeto = coleccion === 'ventasCamion' ? venta.choferId : venta.cajaId;
    if (!fecha || typeof sujeto !== 'string' || !sujeto)
        return null;
    return `${fecha}_${sujeto}`;
}
/** La entrada que queda en el cierre. Pura (salvo la hora). */
function entradaDeAnulacion(ventaId, venta, solicitud) {
    const a = venta.anulacion ?? {};
    const tipo = a.tipo === 'remito' ? 'remito' : a.notaCredito ? 'notaCredito' : 'notaCreditoX';
    const comprobante = tipo === 'remito'
        ? `Remito ${String(venta.tango?.remitoNumero ?? nro(venta.comprobanteInterno?.puntoVenta, venta.comprobanteInterno?.numero))}`
        : tipo === 'notaCredito' ? `NC ${nro(a.notaCredito?.puntoVenta, a.notaCredito?.numero)}` : `NC X ${nro(a.notaCreditoInterna?.puntoVenta, a.notaCreditoInterna?.numero)}`;
    return {
        ventaId,
        clienteNombre: String(venta.clienteNombre ?? ''),
        total: Number(venta.total ?? 0),
        formaPago: String(venta.formaPago ?? ''),
        tipo,
        comprobante,
        motivo: String(a.motivo ?? solicitud?.motivo ?? ''),
        nota: String(a.nota ?? solicitud?.nota ?? ''),
        pedidoPor: String(a.anuladaPor?.nombre ?? solicitud?.solicitadoPor?.nombre ?? ''),
        en: firestore_1.Timestamp.now(),
    };
}
/**
 * Si el cierre de ese día ya existe, le anota la anulación (una vez por venta).
 * Devuelve el id del cierre anotado, o null si no había cierre (la venta se
 * anuló el mismo día, antes de cerrar: no hay nada que anotar).
 */
async function anotarAnulacionPosterior(db, coleccion, ventaId, venta) {
    const id = idDelCierre(coleccion, venta);
    if (!id)
        return null;
    const ref = db.doc(`${coleccion === 'ventasCamion' ? 'liquidaciones' : 'rendiciones'}/${id}`);
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const previas = snap.data()?.anulacionesPosteriores ?? [];
    if (previas.some((p) => p.ventaId === ventaId))
        return id;
    // La solicitud (si la hubo) tiene el motivo y quién pidió; en el remito
    // anulado por el chofer eso ya viene en la venta.
    const solicitud = venta.anulacion?.tipo === 'remito' ? null : (await db.doc(`anulacionesVentanilla/${ventaId}`).get()).data() ?? null;
    await ref.set({ anulacionesPosteriores: firestore_1.FieldValue.arrayUnion(entradaDeAnulacion(ventaId, venta, solicitud)) }, { merge: true });
    return id;
}
//# sourceMappingURL=anulacionesPosteriores.js.map