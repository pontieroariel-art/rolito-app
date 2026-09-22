"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onVentaVentanillaControl = exports.onVentaCamionControl = void 0;
/**
 * Marca la venta cuyo total no cuadra con sus renglones y avisa a facturación
 * y al super_admin (auditoría 2026-09-22). Las reglas no pueden sumar el
 * array; esto es la red del lado servidor. No corrige la venta: la deja
 * marcada (`control.totalDistinto`) para que se vea al liquidar.
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const push_1 = require("../services/push");
const ventasControl_1 = require("../services/ventasControl");
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
async function controlar(coleccion, id, venta) {
    const distinto = (0, ventasControl_1.controlarTotal)(venta);
    if (!distinto)
        return;
    const db = (0, firestore_2.getFirestore)();
    console.warn(`[ventasControl] ${coleccion}/${id}: total ${distinto.declarado} vs renglones ${distinto.esperado}`);
    await db.doc(`${coleccion}/${id}`).set({ control: { totalDistinto: { ...distinto, en: firestore_2.FieldValue.serverTimestamp() } } }, { merge: true });
    try {
        const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get();
        await (0, push_1.enviarPushAUsuarios)(destinatarios.docs, { ...(0, ventasControl_1.avisoTotalDistinto)(coleccion, venta, distinto), url: coleccion === 'ventasCamion' ? '/caja/liquidaciones' : '/tesoreria/ventas' }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() });
    }
    catch (e) {
        console.error(`[ventasControl] push a la oficina falló: ${e.message}`);
    }
}
exports.onVentaCamionControl = (0, firestore_1.onDocumentCreated)({ document: 'ventasCamion/{ventaId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const venta = event.data?.data();
    if (!venta)
        return;
    await controlar('ventasCamion', event.params.ventaId, venta);
});
exports.onVentaVentanillaControl = (0, firestore_1.onDocumentCreated)({ document: 'ventasVentanilla/{ventaId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const venta = event.data?.data();
    if (!venta)
        return;
    await controlar('ventasVentanilla', event.params.ventaId, venta);
});
//# sourceMappingURL=ventasControl.js.map