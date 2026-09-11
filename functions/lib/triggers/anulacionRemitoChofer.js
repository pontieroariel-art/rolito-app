"use strict";
/**
 * Remito de cuenta corriente anulado por el chofer (2026-09-11, decisión de
 * Ariel: sin autorización, para ser ágil en la calle). Camino A: la app saca
 * la venta de la liquidación y del stock del camión; el remito en Tango lo
 * anula la oficina a mano, como hasta hoy.
 *
 *   - onRemitoAnuladoPorChofer: al aparecer `anulacion.tipo = 'remito'` en la
 *     venta, marca `anulacion.tango = pendiente_oficina` y avisa por push a
 *     facturación (y al super_admin) con el número de remito a anular.
 *   - reconciliarRemitosAnulados (cada hora): mira el índice de comprobantes
 *     de Tango que publica el lector de la VM (tangoComprobantes) y, cuando el
 *     remito figura con ESTADO_MOV 'A', deja `anulacion.tango = confirmado`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconciliarRemitosAnulados = exports.onRemitoAnuladoPorChofer = void 0;
exports.avisoRemitoAnulado = avisoRemitoAnulado;
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_2 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const push_1 = require("../services/push");
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
/** Texto de la push a facturación. Pura. */
function avisoRemitoAnulado(venta, a) {
    const ci = venta.comprobanteInterno;
    const numero = String(venta.tango?.remitoNumero ?? (ci ? `${String(ci.puntoVenta ?? 0).padStart(5, '0')}-${String(ci.numero ?? 0).padStart(8, '0')}` : 'sin número'));
    return {
        titulo: 'Remito anulado por el chofer: anularlo en Tango',
        cuerpo: `${String(venta.choferNombre ?? 'Chofer')} anuló el remito ${numero} de ${String(venta.clienteNombre ?? 'cliente')} · ${a.motivo ?? ''}${a.nota ? ` · ${a.nota}` : ''}. Hay que anularlo en Tango.`,
    };
}
exports.onRemitoAnuladoPorChofer = (0, firestore_1.onDocumentUpdated)({ document: 'ventasCamion/{ventaId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const antes = event.data?.before.data()?.anulacion;
    const ahora = event.data?.after.data();
    const a = ahora?.anulacion;
    if (!ahora || !a || a.tipo !== 'remito' || a.estado !== 'anulada')
        return;
    if (antes?.tipo === 'remito' && antes.estado === 'anulada')
        return; // ya procesada
    const db = (0, firestore_2.getFirestore)();
    await event.data.after.ref.set({ anulacion: { tango: { estado: 'pendiente_oficina' } } }, { merge: true });
    try {
        const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get();
        const { titulo, cuerpo } = avisoRemitoAnulado(ahora, a);
        await (0, push_1.enviarPushAUsuarios)(destinatarios.docs, { titulo, cuerpo, url: '/admin/comprobantes' }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() });
    }
    catch (e) {
        console.error(`[remitos] push a facturación falló: ${e.message}`);
    }
});
exports.reconciliarRemitosAnulados = (0, scheduler_1.onSchedule)({ schedule: 'every 60 minutes', timeZone: 'America/Argentina/Buenos_Aires' }, async () => {
    const db = (0, firestore_2.getFirestore)();
    const pendientes = await db.collection('ventasCamion')
        .where('anulacion.tipo', '==', 'remito')
        .where('anulacion.tango.estado', '==', 'pendiente_oficina')
        .limit(200).get();
    let confirmados = 0;
    for (const d of pendientes.docs) {
        const v = d.data();
        const codigo = String(v.clienteCodigoTango ?? '').trim();
        const numero = String(v.tango?.remitoNumero ?? '').trim();
        if (!codigo || !numero)
            continue;
        const idx = (await db.doc(`tangoComprobantes/redonhielo_${codigo}`).get()).data();
        const estado = idx?.remitos?.[numero]?.estado;
        if (estado === 'A') {
            await d.ref.set({ anulacion: { tango: { estado: 'confirmado', en: firestore_2.FieldValue.serverTimestamp() } } }, { merge: true });
            confirmados++;
        }
    }
    console.log(`[remitos] anulados por chofer pendientes en Tango: ${pendientes.size}, confirmados ahora: ${confirmados}`);
});
//# sourceMappingURL=anulacionRemitoChofer.js.map