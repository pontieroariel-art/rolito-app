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
exports.onOrderCreated = (0, firestore_1.onDocumentCreated)({ document: 'orders/{orderId}', secrets: email_1.MAIL_SECRETS }, async (event) => {
    const order = event.data?.data();
    if (!order)
        return;
    // Entrega con remito de fábrica (Coto/Carrefour, 2026-09-23): si el cliente
    // tiene la marca, el pedido nace sellado y el chofer lo entrega sin
    // comprobante de la app. Se sella acá y no en el front para que valga igual
    // lo cargue quien lo cargue (logística, el cliente, un recurrente).
    const clientId = order.clientId;
    if (clientId && clientId !== 'externo' && order.entregaSinComprobante !== true) {
        try {
            const cliente = (await (0, firestore_2.getFirestore)().doc(`users/${clientId}`).get()).data();
            if (cliente?.entregaConRemitoDeFabrica === true)
                await event.data.ref.update({ entregaSinComprobante: true });
        }
        catch (e) {
            console.error(`[onOrderCreated] no se pudo sellar entregaSinComprobante en ${event.params.orderId}: ${e.message}`);
        }
    }
    const clientName = (order.clientName || '');
    const products = (order.products || []);
    const nombre = clientName.split(' ')[0] || 'Cliente';
    // Email al cliente
    const emailCliente = await getClientEmail(order);
    if (emailCliente) {
        await (0, email_1.sendEmail)(emailCliente, 'Pedido recibido - Rolito', (0, templates_1.tplPedidoRecibido)(nombre, products, order.date, order.notes));
    }
    // Aviso interno a la oficina (lista "Nuevo pedido" de Ajustes generales).
    const adminEmails = await (0, email_1.destinatariosAviso)('nuevoPedido');
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
exports.onOrderConfirmado = (0, firestore_1.onDocumentUpdated)({ document: 'orders/{orderId}', secrets: email_1.MAIL_SECRETS }, async (event) => {
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
exports.onOrderEnCamino = (0, firestore_1.onDocumentUpdated)({ document: 'orders/{orderId}', secrets: email_1.MAIL_SECRETS }, async (event) => {
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