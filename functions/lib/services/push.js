"use strict";
/**
 * Push a un conjunto de usuarios (docs de `users` con `pushSubscription`).
 *
 * Mismo patrón que `triggers/supervisor.ts` y `triggers/heladeras.ts` (que
 * siguen con su copia local para no redeployarlos): filtra los que tienen
 * suscripción, manda, y limpia las suscripciones muertas (404/410). Acepta una
 * `url` para que el service worker abra la pantalla que corresponde al tocar
 * la notificación.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enviarPushAUsuarios = enviarPushAUsuarios;
const firestore_1 = require("firebase-admin/firestore");
const web_push_1 = __importDefault(require("web-push"));
function isStaleSubscriptionError(err) {
    const status = err?.statusCode;
    return status === 404 || status === 410;
}
async function enviarPushAUsuarios(docs, aviso, claves) {
    const conSubscripcion = docs.filter((d) => d.data()?.pushSubscription?.endpoint);
    if (conSubscripcion.length === 0)
        return { enviados: 0 };
    web_push_1.default.setVapidDetails('mailto:pedidos@rolito.com.ar', claves.vapidPublicKey, claves.vapidPrivateKey);
    const payload = JSON.stringify({ title: aviso.titulo, body: aviso.cuerpo, ...(aviso.url ? { url: aviso.url } : {}) });
    let enviados = 0;
    await Promise.all(conSubscripcion.map(async (d) => {
        try {
            await web_push_1.default.sendNotification(d.data()?.pushSubscription, payload);
            enviados++;
        }
        catch (err) {
            if (isStaleSubscriptionError(err))
                await d.ref.update({ pushSubscription: firestore_1.FieldValue.delete() }).catch(() => { });
        }
    }));
    return { enviados };
}
//# sourceMappingURL=push.js.map