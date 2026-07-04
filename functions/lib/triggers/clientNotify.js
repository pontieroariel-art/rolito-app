"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyReprogramado = exports.notifyCerca = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const email_1 = require("../email");
const templates_1 = require("../templates");
const STAFF_ROLES = new Set([
    'super_admin', 'gerente_general', 'gerente_comercial',
    'comercial', 'logistica', 'facturacion', 'chofer',
]);
async function getRol(uid) {
    const snap = await (0, firestore_1.getFirestore)().doc(`users/${uid}`).get();
    return (snap.data()?.rol ?? snap.data()?.role);
}
// El cliente avisa que el camión está cerca (distancia calculada por GPS en el
// navegador). El destinatario y el contenido se derivan del pedido en el
// servidor — el cliente solo pasa el orderId, nunca el email → sin relay.
exports.notifyCerca = (0, https_1.onCall)({ secrets: [email_1.resendApiKey] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Requiere autenticación');
    const orderId = (request.data?.orderId ?? '');
    if (!orderId)
        throw new https_1.HttpsError('invalid-argument', 'Falta orderId');
    const snap = await (0, firestore_1.getFirestore)().doc(`orders/${orderId}`).get();
    const o = snap.data();
    if (!o)
        throw new https_1.HttpsError('not-found', 'Pedido inexistente');
    // Solo el dueño del pedido, o el staff, puede disparar el aviso.
    const rol = await getRol(request.auth.uid);
    const esStaff = rol ? STAFF_ROLES.has(rol) : false;
    if (o.clientId !== request.auth.uid && !esStaff) {
        throw new https_1.HttpsError('permission-denied', 'No autorizado');
    }
    const email = o.clientEmail;
    if (!email)
        return { ok: true, skipped: true };
    const nombre = (o.clientName || '').split(' ')[0] || 'Cliente';
    await (0, email_1.sendEmail)(email, 'Tu pedido está cerca 🚚 - Rolito', (0, templates_1.tplPedidoCerca)(nombre, o.products ?? [], email_1.APP_URL));
    return { ok: true };
});
// El staff reprograma un pedido → aviso al cliente. La fecha nueva y el motivo
// ya quedaron persistidos en el pedido por rescheduleOrder antes de esta llamada.
exports.notifyReprogramado = (0, https_1.onCall)({ secrets: [email_1.resendApiKey] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Requiere autenticación');
    const rol = await getRol(request.auth.uid);
    if (!rol || !STAFF_ROLES.has(rol)) {
        throw new https_1.HttpsError('permission-denied', 'Solo el staff puede reprogramar');
    }
    const orderId = (request.data?.orderId ?? '');
    if (!orderId)
        throw new https_1.HttpsError('invalid-argument', 'Falta orderId');
    const snap = await (0, firestore_1.getFirestore)().doc(`orders/${orderId}`).get();
    const o = snap.data();
    if (!o)
        throw new https_1.HttpsError('not-found', 'Pedido inexistente');
    const email = o.clientEmail;
    if (!email)
        return { ok: true, skipped: true };
    const nombre = (o.clientName || '').split(' ')[0] || 'Cliente';
    const motivo = o.motivoReprogramacion || 'Sin especificar';
    await (0, email_1.sendEmail)(email, 'Tu pedido fue reprogramado 📅 - Rolito', (0, templates_1.tplPedidoReprogramado)(nombre, o.products ?? [], o.date, motivo));
    return { ok: true };
});
//# sourceMappingURL=clientNotify.js.map