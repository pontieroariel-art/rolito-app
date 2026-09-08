"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onVisitaSupervisorCreada = exports.onPedidoSupervisorCreado = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const web_push_1 = __importDefault(require("web-push"));
// Avisos a logística por lo que el supervisor toma en la calle (2026-09-07):
// un pedido (entra a la Bandeja sin día) o una visita (sin chofer). Server-
// side porque el supervisor no puede leer el directorio de staff (reglas de
// `users`) ni disparar push a otros. Solo avisa cuando el doc trae
// `origenSupervisor`; el resto de pedidos/visitas los crea logística misma.
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
function isStaleSubscriptionError(err) {
    const status = err?.statusCode;
    return status === 404 || status === 410;
}
async function avisarLogistica(titulo, cuerpo) {
    const db = (0, firestore_2.getFirestore)();
    const [logistica, admins] = await Promise.all([
        db.collection('users').where('rol', '==', 'logistica').where('estado', '==', 'activo').get(),
        db.collection('users').where('rol', '==', 'super_admin').where('estado', '==', 'activo').get(),
    ]);
    const conSubscripcion = [...logistica.docs, ...admins.docs].filter((d) => d.data().pushSubscription?.endpoint);
    if (conSubscripcion.length === 0)
        return;
    web_push_1.default.setVapidDetails('mailto:pedidos@rolito.com.ar', vapidPublicKey.value(), vapidPrivateKey.value());
    await Promise.all(conSubscripcion.map(async (d) => {
        try {
            await web_push_1.default.sendNotification(d.data().pushSubscription, JSON.stringify({ title: titulo, body: cuerpo }));
        }
        catch (err) {
            if (isStaleSubscriptionError(err))
                await d.ref.update({ pushSubscription: firestore_2.FieldValue.delete() }).catch(() => { });
        }
    }));
}
const nombreDe = (o) => (o.origenSupervisor?.nombre ?? 'un supervisor');
exports.onPedidoSupervisorCreado = (0, firestore_1.onDocumentCreated)({ document: 'orders/{orderId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const o = event.data?.data();
    if (!o?.origenSupervisor)
        return;
    const productos = (o.products ?? [])
        .map((p) => `${p.quantity ?? ''} ${p.name ?? ''}`.trim()).join(', ');
    await avisarLogistica('Pedido a programar', `${(o.clientName ?? '')} — ${productos || 'sin productos'} (lo tomó ${nombreDe(o)})`);
});
exports.onVisitaSupervisorCreada = (0, firestore_1.onDocumentCreated)({ document: 'visitas-puntuales/{visitaId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const v = event.data?.data();
    if (!v?.origenSupervisor)
        return;
    await avisarLogistica('Visita a asignar', `${(v.clientName ?? '')}${v.notas ? `: ${v.notas}` : ''} (la pidió ${nombreDe(v)})`);
});
//# sourceMappingURL=supervisor.js.map