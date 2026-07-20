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
// 404/410 de un push provider significan que la suscripción ya no es válida
// (el navegador la revocó o el usuario desinstaló la PWA) — reintentar no
// tiene sentido, hay que dejar de usarla.
function isStaleSubscriptionError(err) {
    const status = err?.statusCode;
    return status === 404 || status === 410;
}
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
        return { ok: true, delivered: true };
    }
    catch (err) {
        console.error('sendPush error:', err);
        const stale = isStaleSubscriptionError(err);
        if (stale) {
            // Limpiar el pushSubscription del perfil que la tenía guardada, para
            // no seguir intentando enviarle notificaciones a un endpoint muerto
            // en cada evento futuro sin que nadie se entere de que nunca llegan.
            try {
                const usersRef = (0, firestore_1.getFirestore)().collection('users');
                const owner = await usersRef
                    .where('pushSubscription.endpoint', '==', subscription.endpoint)
                    .limit(1)
                    .get();
                if (!owner.empty) {
                    await owner.docs[0].ref.update({ pushSubscription: firestore_1.FieldValue.delete() });
                }
            }
            catch (cleanupErr) {
                console.error('sendPush cleanup error:', cleanupErr);
            }
        }
        // No relanzamos el error: una suscripción vencida no debe romper el
        // flujo del que llama (confirmar despacho, reasignar, etc.), pero sí
        // devolvemos el resultado real en vez de mentir con ok:true siempre.
        return { ok: false, delivered: false, staleSubscription: stale };
    }
});
//# sourceMappingURL=push.js.map