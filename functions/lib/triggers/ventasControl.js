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
async function avisarOficina(aviso, url) {
    try {
        const db = (0, firestore_2.getFirestore)();
        const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get();
        await (0, push_1.enviarPushAUsuarios)(destinatarios.docs, { ...aviso, url }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() });
    }
    catch (e) {
        console.error(`[ventasControl] push a la oficina falló: ${e.message}`);
    }
}
/**
 * Precio de cada renglón contra la lista del cliente (2026-09-26, auditoría del
 * chofer, C5): el precio unitario lo pone el teléfono. Solo en el camión y solo
 * en lo que se cobra (los cambios van aparte y en $0). Empresa por canal: promo
 * es Rolito, contado es Redonhielo. No corrige la venta: la marca y avisa.
 */
async function controlarPrecio(id, venta) {
    if (typeof venta.clienteId !== 'string' || !venta.clienteId)
        return;
    const db = (0, firestore_2.getFirestore)();
    const cliente = (await db.doc(`users/${venta.clienteId}`).get()).data();
    const empresa = venta.canal === 'promo' ? 'rolito' : 'redonhielo';
    const precios = cliente?.preciosTango?.[empresa];
    const distintos = (0, ventasControl_1.controlarPrecios)(venta.items, precios);
    if (!distintos.length)
        return;
    console.warn(`[ventasControl] ventasCamion/${id}: ${distintos.length} renglón(es) con precio distinto de la lista`);
    await db.doc(`ventasCamion/${id}`).set({ control: { precioDistinto: { renglones: distintos, en: firestore_2.FieldValue.serverTimestamp() } } }, { merge: true });
    await avisarOficina((0, ventasControl_1.avisoPrecioDistinto)(venta, distintos), '/caja/liquidaciones');
}
async function controlar(coleccion, id, venta) {
    if (coleccion === 'ventasCamion') {
        try {
            await controlarPrecio(id, venta);
        }
        catch (e) {
            console.error(`[ventasControl] control de precio falló: ${e.message}`);
        }
    }
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