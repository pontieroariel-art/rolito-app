"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = exports.APP_URL = exports.FROM_EMAIL = exports.resendApiKey = void 0;
const resend_1 = require("resend");
const firestore_1 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
exports.resendApiKey = (0, params_1.defineSecret)('RESEND_API_KEY');
exports.FROM_EMAIL = process.env.FROM_EMAIL ?? 'Rolito <onboarding@resend.dev>';
exports.APP_URL = process.env.APP_URL ?? 'https://rolito-app.web.app';
const sendEmail = async (to, subject, html) => {
    const apiKey = exports.resendApiKey.value();
    if (!apiKey) {
        console.warn('RESEND_API_KEY no configurada — email omitido:', subject);
        return;
    }
    const resend = new resend_1.Resend(apiKey);
    // Modo test: redirige todos los emails a la dirección de prueba
    let recipient = to;
    try {
        const db = (0, firestore_1.getFirestore)();
        const configSnap = await db.doc('configuracion/notificaciones').get();
        const config = configSnap.data();
        if (config?.modoTest === true && config?.testEmail) {
            const destinos = Array.isArray(to) ? to.join(', ') : to;
            console.log(`[MODO TEST] Email interceptado → para: ${destinos} → redirigido a: ${config.testEmail} | Asunto: ${subject}`);
            recipient = config.testEmail;
            subject = `[TEST → ${destinos}] ${subject}`;
        }
    }
    catch {
        // Si falla la lectura de config, enviamos al destino real
    }
    try {
        const { error } = await resend.emails.send({
            from: exports.FROM_EMAIL,
            to: recipient,
            subject,
            html,
        });
        if (error)
            console.error('Resend error:', error);
    }
    catch (err) {
        console.error('Error enviando email:', err);
    }
};
exports.sendEmail = sendEmail;
//# sourceMappingURL=email.js.map