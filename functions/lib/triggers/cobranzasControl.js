"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onCobranzaControl = void 0;
/**
 * Marca el recibo que no cuadra y avisa a facturación y al super_admin
 * (auditoría 2026-09-22). La parte que importa —no mandarlo a Tango ni
 * descontar el saldo— está en onCobranzaCreada (tangoOutbox.ts), que corre la
 * misma cuenta pura antes de encolar.
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const push_1 = require("../services/push");
const cobranzasControl_1 = require("../services/cobranzasControl");
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
exports.onCobranzaControl = (0, firestore_1.onDocumentCreated)({ document: 'cobranzas/{cobranzaId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const c = event.data?.data();
    if (!c)
        return;
    // Las cobranzas simples viejas (sin imputaciones ni a cuenta) no viajan a Tango: no se controlan.
    if (!Array.isArray(c.imputaciones) || (c.imputaciones.length === 0 && !(Number(c.aCuenta) > 0)))
        return;
    const descuadre = (0, cobranzasControl_1.controlarRecibo)(c);
    if (!descuadre)
        return;
    const db = (0, firestore_2.getFirestore)();
    console.error(`[cobranzasControl] cobranzas/${event.params.cobranzaId} no cuadra: ${descuadre.motivos.join(' ')}`);
    await db.doc(`cobranzas/${event.params.cobranzaId}`).set({ control: { descuadre: { ...descuadre, en: firestore_2.FieldValue.serverTimestamp() } } }, { merge: true });
    try {
        const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get();
        await (0, push_1.enviarPushAUsuarios)(destinatarios.docs, { ...(0, cobranzasControl_1.avisoDescuadre)(c, descuadre), url: '/tesoreria' }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() });
    }
    catch (e) {
        console.error(`[cobranzasControl] push a la oficina falló: ${e.message}`);
    }
});
//# sourceMappingURL=cobranzasControl.js.map