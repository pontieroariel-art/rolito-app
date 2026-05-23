"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onOrderEnCamino = exports.onOrderCreated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const email_1 = require("../email");
const templates_1 = require("../templates");
// Dispara cuando se crea un pedido en orders/{orderId}
// Envía confirmación al cliente y notificación a los emails admin configurados
exports.onOrderCreated = (0, firestore_1.onDocumentCreated)('orders/{orderId}', async (event) => {
    var _a, _b, _c, _d;
    const order = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!order)
        return;
    const db = (0, firestore_2.getFirestore)();
    const clientEmail = order.clientEmail;
    const clientName = (order.clientName || '');
    const products = (order.products || []);
    const date = order.date;
    const notes = (order.notes || '');
    // — Notificación al cliente ------------------------------------------------
    // Si el pedido incluye el email del cliente, enviamos directamente.
    // Si no (pedidos viejos), lo buscamos en Firestore por clientId.
    let emailToClient = clientEmail;
    if (!emailToClient && order.clientId) {
        try {
            const userSnap = await db.doc(`users/${order.clientId}`).get();
            emailToClient = (_b = userSnap.data()) === null || _b === void 0 ? void 0 : _b.email;
        }
        catch (_e) {
            // silencioso — no bloqueamos el trigger si falla el lookup
        }
    }
    const nombre = clientName.split(' ')[0] || 'Cliente';
    if (emailToClient) {
        await (0, email_1.sendEmail)(emailToClient, 'Pedido recibido - Rolito', (0, templates_1.tplPedidoRecibido)(nombre, products, date, notes));
    }
    // — Notificación a administración -----------------------------------------
    let adminEmails = [];
    try {
        const notifSnap = await db.doc('configuracion/notificaciones').get();
        adminEmails = (_d = (_c = notifSnap.data()) === null || _c === void 0 ? void 0 : _c.emails) !== null && _d !== void 0 ? _d : [];
    }
    catch (_f) {
        // sin config → no notificamos
    }
    if (adminEmails.length > 0) {
        await (0, email_1.sendEmail)(adminEmails, `Nuevo pedido de ${clientName}`, (0, templates_1.tplAdminNuevoPedido)({
            clientName,
            clientAddress: (order.clientAddress || ''),
            clientPhone: (order.clientPhone || ''),
            products,
            date,
            notes,
        }));
    }
});
// Dispara cuando se actualiza un pedido en orders/{orderId}
// Solo actúa cuando el status cambia a 'en_camino'
exports.onOrderEnCamino = (0, firestore_1.onDocumentUpdated)('orders/{orderId}', async (event) => {
    var _a, _b, _c;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    if (!before || !after)
        return;
    if (before.status === 'en_camino' || after.status !== 'en_camino')
        return;
    const db = (0, firestore_2.getFirestore)();
    const clientName = (after.clientName || '');
    const products = (after.products || []);
    const nombre = clientName.split(' ')[0] || 'Cliente';
    // Obtenemos el email del cliente
    let emailToClient = after.clientEmail;
    if (!emailToClient && after.clientId) {
        try {
            const userSnap = await db.doc(`users/${after.clientId}`).get();
            emailToClient = (_c = userSnap.data()) === null || _c === void 0 ? void 0 : _c.email;
        }
        catch (_d) {
            // silencioso
        }
    }
    if (!emailToClient)
        return;
    await (0, email_1.sendEmail)(emailToClient, 'Tu pedido está en camino 🚛', (0, templates_1.tplPedidoEnCamino)(nombre, products, email_1.APP_URL));
});
//# sourceMappingURL=orders.js.map