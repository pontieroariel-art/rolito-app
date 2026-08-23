"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enviarResumenAdminDiario = exports.onHistorialAdminAltoRiesgo = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_2 = require("firebase-admin/firestore");
const email_1 = require("../email");
const templates_1 = require("../templates");
const TZ = 'America/Argentina/Buenos_Aires';
async function adminEmails() {
    try {
        const snap = await (0, firestore_2.getFirestore)().doc('configuracion/notificaciones').get();
        return (snap.data()?.emails ?? []);
    }
    catch {
        return [];
    }
}
// Alerta instantánea — cambio de rol, alta/baja de personal (riesgo='alto'
// en historialAdminService.ts). Ver plan de migración del Backoffice, Fase 4.
exports.onHistorialAdminAltoRiesgo = (0, firestore_1.onDocumentCreated)({ document: 'historialAdmin/{eventoId}', secrets: [email_1.resendApiKey] }, async (event) => {
    const data = event.data?.data();
    if (!data || data.riesgo !== 'alto')
        return;
    const emails = await adminEmails();
    if (emails.length === 0)
        return;
    const actor = data.actor;
    await (0, email_1.sendEmail)(emails, `Backoffice: ${data.accion ?? 'cambio'} — ${data.coleccion ?? ''}`, (0, templates_1.tplAdminAccionAltoRiesgo)({
        actorNombre: actor?.nombre ?? 'Alguien',
        actorRol: actor?.rol ?? '',
        coleccion: (data.coleccion ?? ''),
        accion: (data.accion ?? ''),
        detalle: (data.detalle ?? null),
    }, email_1.APP_URL));
});
// Resumen diario — todo lo de riesgo='rutina' del día anterior (Flota,
// Modelos, Catálogos de service, Técnicos, Pañol). Corre después de
// generarPedidosRecurrentes (6am ART) para no competir por cuota.
exports.enviarResumenAdminDiario = (0, scheduler_1.onSchedule)({ schedule: '0 7 * * *', timeZone: TZ, secrets: [email_1.resendApiKey] }, async () => {
    const db = (0, firestore_2.getFirestore)();
    // Rango [ayer 00:00, hoy 00:00) visto desde Argentina.
    const hoyPartes = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
    const hoyInicio = new Date(`${hoyPartes}T00:00:00-03:00`);
    const ayerInicio = new Date(hoyInicio);
    ayerInicio.setDate(ayerInicio.getDate() - 1);
    const snap = await db.collection('historialAdmin')
        .where('riesgo', '==', 'rutina')
        .where('fecha', '>=', firestore_2.Timestamp.fromDate(ayerInicio))
        .where('fecha', '<', firestore_2.Timestamp.fromDate(hoyInicio))
        .orderBy('fecha', 'asc')
        .get();
    if (snap.empty) {
        console.log('[enviarResumenAdminDiario] sin cambios de rutina ayer, no se manda mail');
        return;
    }
    const emails = await adminEmails();
    if (emails.length === 0)
        return;
    const eventos = snap.docs.map((d) => {
        const data = d.data();
        const actor = data.actor;
        return {
            actorNombre: actor?.nombre ?? 'Alguien',
            coleccion: (data.coleccion ?? ''),
            accion: (data.accion ?? ''),
            detalle: (data.detalle ?? null),
        };
    });
    await (0, email_1.sendEmail)(emails, `Backoffice: resumen diario (${eventos.length} cambio${eventos.length !== 1 ? 's' : ''})`, (0, templates_1.tplAdminResumenDiario)(eventos, email_1.APP_URL));
});
//# sourceMappingURL=adminAudit.js.map