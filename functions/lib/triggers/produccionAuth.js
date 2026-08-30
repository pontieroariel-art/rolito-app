"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPinProduccion = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const rateLimit_1 = require("../rateLimit");
// Mismo formato que src/services/produccionAuthService.ts (padPinProduccion):
// el PIN ES la contraseña de Auth (nunca se guarda en Firestore); el sufijo
// cumple el mínimo de 6 caracteres de Firebase Auth cuando el PIN son 4 dígitos.
function padPinProduccion(pin) {
    return `${pin.replace(/\D/g, '')}__pr`;
}
// PIN aleatorio de 4 dígitos (1000–9999, sin ceros a la izquierda que se
// pierdan). No se deriva del legajo a propósito: el legajo es semi-público
// (aparece en el índice de login). Igual que scripts/migrar-pin-produccion.mjs.
function nuevoPin() {
    return String(Math.floor(1000 + Math.random() * 9000));
}
// Reset del PIN de un operario de producción desde el panel del encargado.
// Cambiar la contraseña de OTRO usuario requiere el Admin SDK (el SDK cliente
// solo puede cambiar la del usuario logueado), por eso es una callable y no se
// hace desde el navegador. Reemplaza tener que correr a mano
// scripts/migrar-pin-produccion.mjs cuando un operario se olvida el PIN
// (mejora pendiente anotada en la auditoría 2026-08-29, H1). Devuelve el PIN
// nuevo para que el encargado se lo comunique; no queda guardado en ningún
// lado consultable.
exports.resetPinProduccion = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Requiere autenticación');
    }
    const db = (0, firestore_1.getFirestore)();
    // Solo el encargado de producción (o super_admin) puede resetear PINs.
    const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
    const callerRol = (callerSnap.data()?.rol ?? callerSnap.data()?.role);
    if (callerRol !== 'produccion_encargado' && callerRol !== 'super_admin') {
        throw new https_1.HttpsError('permission-denied', 'Solo el encargado de producción puede resetear PINs');
    }
    // Defensa en profundidad ante un token de encargado comprometido/scripteado.
    await (0, rateLimit_1.assertRateLimit)(request.auth.uid, 'resetPinProduccion', 20, 60);
    const { operarioUid } = (request.data ?? {});
    if (!operarioUid || typeof operarioUid !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Falta operarioUid');
    }
    // El uid del doc de Firestore ES el uid de Auth (createUserViaSecondaryApp
    // escribe users/{credential.user.uid}). Confirmamos que el target sea de
    // verdad un operario de producción antes de tocarle la contraseña — así el
    // encargado no puede resetear la de un staff/cliente pasando otro uid.
    const targetSnap = await db.doc(`users/${operarioUid}`).get();
    if (!targetSnap.exists) {
        throw new https_1.HttpsError('not-found', 'No existe ese operario');
    }
    const targetRol = (targetSnap.data()?.rol ?? targetSnap.data()?.role);
    if (targetRol !== 'produccion_hielo') {
        throw new https_1.HttpsError('failed-precondition', 'Ese usuario no es un operario de producción');
    }
    const pin = nuevoPin();
    try {
        await (0, auth_1.getAuth)().updateUser(operarioUid, { password: padPinProduccion(pin) });
    }
    catch (err) {
        console.error('[resetPinProduccion] error actualizando la contraseña:', err);
        throw new https_1.HttpsError('internal', 'No se pudo resetear el PIN. Intentá de nuevo.');
    }
    return { pin };
});
//# sourceMappingURL=produccionAuth.js.map