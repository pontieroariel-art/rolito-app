"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onUserApproved = exports.onUserRegistered = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const email_1 = require("../email");
const templates_1 = require("../templates");
// Dispara cuando se crea un documento en users/{uid}
// Solo notifica a clientes con estado 'pendiente'
exports.onUserRegistered = (0, firestore_1.onDocumentCreated)('users/{uid}', async (event) => {
    var _a;
    const data = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
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
// Dispara cuando se actualiza un documento en users/{uid}
// Solo notifica cuando el estado cambia de 'pendiente' a 'activo'
exports.onUserApproved = (0, firestore_1.onDocumentUpdated)('users/{uid}', async (event) => {
    var _a, _b;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
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