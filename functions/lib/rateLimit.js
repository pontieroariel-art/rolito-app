"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertRateLimit = assertRateLimit;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
// Límite de frecuencia simple por uid+función, para que un token de staff/cliente
// comprometido (o scripteado) no pueda machacar un callable sin límite — la
// autenticación y el chequeo de rol ya cierran el acceso, esto es defensa en
// profundidad. Ventana fija (no sliding window): si `windowStart` tiene más de
// `windowSeconds`, se reinicia el contador en 1 en vez de acumular indefinido.
async function assertRateLimit(uid, key, limit, windowSeconds) {
    const ref = (0, firestore_1.getFirestore)().doc(`_rateLimits/${uid}_${key}`);
    await (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        const now = Date.now();
        const windowStart = data?.windowStart?.toMillis() ?? 0;
        const withinWindow = now - windowStart < windowSeconds * 1000;
        if (withinWindow && (data?.count ?? 0) >= limit) {
            throw new https_1.HttpsError('resource-exhausted', 'Demasiadas solicitudes, esperá un momento e intentá de nuevo');
        }
        if (withinWindow) {
            tx.set(ref, { count: firestore_1.FieldValue.increment(1) }, { merge: true });
        }
        else {
            tx.set(ref, { count: 1, windowStart: firestore_1.Timestamp.fromMillis(now) });
        }
    });
}
//# sourceMappingURL=rateLimit.js.map