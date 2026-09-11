"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.esImpersonado = esImpersonado;
exports.assertNoImpersonado = assertNoImpersonado;
const https_1 = require("firebase-functions/v2/https");
// Sesión "Ver como" del super_admin (2026-09-10): el custom token que emite
// crearTokenImpersonacion trae el claim `impersonadoPor`. Esa sesión es de
// SOLO LECTURA: las reglas de Firestore ya rechazan sus escrituras, y esto
// cierra la otra puerta — las callables, que escriben con el Admin SDK y
// resuelven el rol por el uid del token (que es el de la persona observada).
function esImpersonado(request) {
    return typeof request.auth?.token?.impersonadoPor === 'string';
}
function assertNoImpersonado(request) {
    if (esImpersonado(request)) {
        throw new https_1.HttpsError('permission-denied', 'Sesión de solo lectura (Ver como): esta acción no está disponible');
    }
}
//# sourceMappingURL=authz.js.map