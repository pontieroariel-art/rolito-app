"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPush = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const web_push_1 = __importDefault(require("web-push"));
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
// Envío de web-push desde el servidor. Reemplaza la Netlify Function `send-push`,
// que quedó inalcanzable al hostear la app en Firebase Hosting (las llamadas
// relativas a /.netlify/functions caían en el rewrite SPA). Al ser una callable
// del mismo proyecto: sin CORS, con auth automática, y solo el staff puede
// disparar notificaciones (cierra el relay abierto que tenía la función vieja).
exports.sendPush = (0, https_1.onCall)({ secrets: [vapidPublicKey, vapidPrivateKey] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Requiere autenticación');
    }
    // Solo el staff envía notificaciones (nunca un cliente)
    const snap = await (0, firestore_1.getFirestore)().doc(`users/${request.auth.uid}`).get();
    const rol = (snap.data()?.rol ?? snap.data()?.role);
    if (!rol || rol === 'cliente') {
        throw new https_1.HttpsError('permission-denied', 'Solo el staff puede enviar notificaciones');
    }
    const { subscription, title, body } = (request.data ?? {});
    if (!subscription?.endpoint || !title) {
        throw new https_1.HttpsError('invalid-argument', 'Faltan subscription o title');
    }
    web_push_1.default.setVapidDetails('mailto:pedidos@rolito.com.ar', vapidPublicKey.value(), vapidPrivateKey.value());
    try {
        await web_push_1.default.sendNotification(subscription, JSON.stringify({ title, body: body ?? '' }));
    }
    catch (err) {
        // Una suscripción vencida o inválida no debe romper el flujo del que llama.
        console.error('sendPush error:', err);
    }
    return { ok: true };
});
//# sourceMappingURL=push.js.map