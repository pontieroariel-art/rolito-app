"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onStockBajo = exports.onTicketCerrado = exports.onTicketCreado = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const web_push_1 = __importDefault(require("web-push"));
const email_1 = require("../email");
const templates_1 = require("../templates");
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
async function getClientEmail(clientId) {
    if (!clientId)
        return undefined;
    try {
        const snap = await (0, firestore_2.getFirestore)().doc(`users/${clientId}`).get();
        return snap.data()?.email;
    }
    catch {
        return undefined;
    }
}
function isStaleSubscriptionError(err) {
    const status = err?.statusCode;
    return status === 404 || status === 410;
}
// Ticket recién creado → push a los encargados. Un ticket que abre el
// cliente (autogestionado desde "Mis heladeras") no lo conoce nadie del
// staff todavía, así que siempre avisa; uno que abre el staff (Toma de
// service) ya lo conoce quien lo creó, así que solo avisa si es urgente
// (mismo criterio de antes, cuando este aviso era client-initiated). Server-
// side porque `sendPush` le prohíbe explícitamente a un cliente disparar
// notificaciones, y porque el cliente tampoco puede leer el directorio de
// encargados (reglas de `users`).
exports.onTicketCreado = (0, firestore_1.onDocumentCreated)({ document: 'ticketsServicio/{ticketId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const ticket = event.data?.data();
    if (!ticket)
        return;
    const esDeCliente = ticket.origen === 'cliente';
    const urgente = ticket.urgente === true;
    if (!esDeCliente && !urgente)
        return;
    const encargados = await (0, firestore_2.getFirestore)().collection('users')
        .where('rol', '==', 'heladeras_encargado').where('estado', '==', 'activo').get();
    const conSubscripcion = encargados.docs.filter((d) => d.data().pushSubscription?.endpoint);
    if (conSubscripcion.length === 0)
        return;
    const titulo = urgente ? 'Service urgente' : 'Nuevo pedido de service';
    const cuerpo = `${(ticket.heladeraCodigo || '')} — ${(ticket.clientName || '')}: ${(ticket.motivoNombre || '')}`;
    web_push_1.default.setVapidDetails('mailto:pedidos@rolito.com.ar', vapidPublicKey.value(), vapidPrivateKey.value());
    await Promise.all(conSubscripcion.map(async (d) => {
        try {
            await web_push_1.default.sendNotification(d.data().pushSubscription, JSON.stringify({ title: titulo, body: cuerpo }));
        }
        catch (err) {
            if (isStaleSubscriptionError(err)) {
                await d.ref.update({ pushSubscription: firestore_2.FieldValue.delete() }).catch(() => { });
            }
        }
    }));
});
// Ticket de service cerrado → email al cliente. El técnico/chofer que hace
// el trabajo en campo no está en condiciones de avisar (cierra el encargado
// desde Consulta de service, a veces horas después), por eso es un trigger
// server-side y no un push client-initiated como el resto del módulo.
exports.onTicketCerrado = (0, firestore_1.onDocumentUpdated)({ document: 'ticketsServicio/{ticketId}', secrets: [email_1.resendApiKey] }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    if (before.estado === 'cerrado' || after.estado !== 'cerrado')
        return;
    const email = await getClientEmail(after.clientId);
    if (!email)
        return;
    const clientName = (after.clientName || '');
    const nombre = clientName.split(' ')[0] || 'Cliente';
    await (0, email_1.sendEmail)(email, 'Tu service fue completado - Rolito', (0, templates_1.tplTicketCerrado)(nombre, (after.heladeraCodigo || ''), (after.motivoNombre || ''), after.trabajoRealizado, email_1.APP_URL));
});
// Cruce por debajo del stock mínimo → email a los encargados de heladeras.
// La transacción que descuenta stock (registrarEntrega) no tiene forma de
// saber si ESE movimiento cruzó el mínimo sin leer el doc post-escritura, así
// que se resuelve acá con el before/after real de Firestore. `avisoStockBajoEnviado`
// evita reenviar en cada movimiento mientras el stock sigue bajo, pero se
// resetea apenas se repone por encima del mínimo para poder re-disparar en un
// futuro cruce (a diferencia de avisoCercaEnviado, que es one-shot por pedido).
exports.onStockBajo = (0, firestore_1.onDocumentUpdated)({ document: 'panolArticulos/{articuloId}', secrets: [email_1.resendApiKey] }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    const stockActual = after.stockActual;
    const stockMinimo = after.stockMinimo;
    const stockAntes = before.stockActual;
    const minimoAntes = before.stockMinimo;
    // Se repuso por encima del mínimo: rearma el aviso para el próximo cruce.
    if (stockActual >= stockMinimo) {
        if (after.avisoStockBajoEnviado === true)
            await event.data.after.ref.update({ avisoStockBajoEnviado: false });
        return;
    }
    const yaEstabaBajo = stockAntes < minimoAntes;
    const yaAvisado = after.avisoStockBajoEnviado === true;
    if (yaEstabaBajo || yaAvisado)
        return;
    await event.data.after.ref.update({ avisoStockBajoEnviado: true });
    let encargadosEmails = [];
    try {
        const snap = await (0, firestore_2.getFirestore)().collection('users')
            .where('rol', '==', 'heladeras_encargado').where('estado', '==', 'activo').get();
        encargadosEmails = snap.docs.map((d) => d.data().email).filter(Boolean);
    }
    catch { /* sin encargados configurados */ }
    if (encargadosEmails.length === 0)
        return;
    await (0, email_1.sendEmail)(encargadosEmails, `Stock bajo: ${(after.nombre || '')} - Rolito`, (0, templates_1.tplStockBajo)({ nombre: (after.nombre || ''), stockActual, stockMinimo }, email_1.APP_URL));
});
//# sourceMappingURL=heladeras.js.map