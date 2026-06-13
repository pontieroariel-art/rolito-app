"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onUserApproved = exports.onUserRegistered = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const email_1 = require("../email");
const templates_1 = require("../templates");
exports.onUserRegistered = (0, firestore_1.onDocumentCreated)({ document: 'users/{uid}', secrets: [email_1.resendApiKey] }, async (event) => {
    const data = event.data?.data();
    if (!data)
        return;
    if (data.rol !== 'cliente' || data.estado !== 'pendiente')
        return;
    const nombre = (data.nombreContacto || data.nombre || 'Cliente');
    const email = data.email;
    if (!email)
        return;
    await (0, email_1.sendEmail)(email, 'Tu cuenta en Rolito está siendo verificada', (0, templates_1.tplRegistroPendiente)(nombre));
});
exports.onUserApproved = (0, firestore_1.onDocumentUpdated)({ document: 'users/{uid}', secrets: [email_1.resendApiKey] }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    if (before.estado !== 'pendiente' || after.estado !== 'activo')
        return;
    if (after.rol !== 'cliente')
        return;
    const nombre = (after.nombreContacto || after.nombre || 'Cliente');
    const email = after.email;
    if (!email)
        return;
    await (0, email_1.sendEmail)(email, '¡Tu cuenta en Rolito fue aprobada!', (0, templates_1.tplCuentaAprobada)(nombre, email_1.APP_URL));
});
//# sourceMappingURL=users.js.map