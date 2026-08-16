"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onStockBajo = exports.onTicketCerrado = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const email_1 = require("../email");
const templates_1 = require("../templates");
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