"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = exports.APP_URL = exports.FROM_EMAIL = void 0;
const resend_1 = require("resend");
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
exports.FROM_EMAIL = (_a = process.env.FROM_EMAIL) !== null && _a !== void 0 ? _a : 'onboarding@resend.dev';
exports.APP_URL = (_b = process.env.APP_URL) !== null && _b !== void 0 ? _b : 'https://rolito-app.vercel.app';
const sendEmail = async (to, subject, html) => {
    if (!process.env.RESEND_API_KEY) {
        console.warn('RESEND_API_KEY no configurada — email omitido:', subject);
        return;
    }
    try {
        const { error } = await resend.emails.send({
            from: `Rolito <${exports.FROM_EMAIL}>`,
            to,
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