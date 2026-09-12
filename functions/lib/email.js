"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = exports.APP_URL = exports.FROM_EMAIL = exports.resendApiKey = void 0;
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
    // Import diferido (2026-09-12): la librería solo se carga cuando se manda un mail.
    const { Resend } = await Promise.resolve().then(() => __importStar(require('resend')));
    const resend = new Resend(apiKey);
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