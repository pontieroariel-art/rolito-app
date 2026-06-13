"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onOrderEnCamino = exports.onOrderConfirmado = exports.onOrderCreated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const email_1 = require("../email");
const templates_1 = require("../templates");
async function getClientEmail(order) {
    if (order.clientEmail)
        return order.clientEmail;
    if (order.clientId) {
        try {
            const snap = await (0, firestore_2.getFirestore)().doc(`users/${order.clientId}`).get();
            return snap.data()?.email;
        }
        catch { /* silencioso */ }
    }
    return undefined;
}
// Nuevo pedido → email al cliente + email al admin
exports.onOrderCreated = (0, firestore_1.onDocumentCreated)({ document: 'orders/{orderId}', secrets: [email_1.resendApiKey] }, async (event) => {
    const order = event.data?.data();
    if (!order)
        return;
    const clientName = (order.clientName || '');
    const products = (order.products || []);
    const nombre = clientName.split(' ')[0] || 'Cliente';
    // Email al cliente
    const emailCliente = await getClientEmail(order);
    if (emailCliente) {
        await (0, email_1.sendEmail)(emailCliente, 'Pedido recibido - Rolito', (0, templates_1.tplPedidoRecibido)(nombre, products, order.date, order.notes));
    }
    // Email al admin
    let adminEmails = [];
    try {
        const snap = await (0, firestore_2.getFirestore)().doc('configuracion/notificaciones').get();
        adminEmails = (snap.data()?.emails ?? []);
    }
    catch { /* sin config */ }
    if (adminEmails.length > 0) {
        await (0, email_1.sendEmail)(adminEmails, `Nuevo pedido de ${clientName}`, (0, templates_1.tplAdminNuevoPedido)({
            clientName,
            clientAddress: (order.clientAddress || ''),
            clientPhone: (order.clientPhone || ''),
            products,
            date: order.date,
            notes: order.notes,
        }));
    }
});
// Pedido confirmado → email al cliente
exports.onOrderConfirmado = (0, firestore_1.onDocumentUpdated)({ document: 'orders/{orderId}', secrets: [email_1.resendApiKey] }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    if (before.status === 'confirmado' || after.status !== 'confirmado')
        return;
    const clientName = (after.clientName || '');
    const products = (after.products || []);
    const nombre = clientName.split(' ')[0] || 'Cliente';
    const emailCliente = await getClientEmail(after);
    if (!emailCliente)
        return;
    await (0, email_1.sendEmail)(emailCliente, 'Tu pedido fue confirmado ✅ - Rolito', (0, templates_1.tplPedidoConfirmado)(nombre, products, after.date));
});
// Pedido en camino → email al cliente
exports.onOrderEnCamino = (0, firestore_1.onDocumentUpdated)({ document: 'orders/{orderId}', secrets: [email_1.resendApiKey] }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    if (before.status === 'en_camino' || after.status !== 'en_camino')
        return;
    const clientName = (after.clientName || '');
    const products = (after.products || []);
    const nombre = clientName.split(' ')[0] || 'Cliente';
    const emailCliente = await getClientEmail(after);
    if (!emailCliente)
        return;
    await (0, email_1.sendEmail)(emailCliente, 'Tu pedido está en camino 🚛 - Rolito', (0, templates_1.tplPedidoEnCamino)(nombre, products, email_1.APP_URL));
});
//# sourceMappingURL=orders.js.map