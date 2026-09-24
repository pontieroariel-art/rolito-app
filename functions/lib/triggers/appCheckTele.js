"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenAppCheckTele = exports.claveTele = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const app_check_1 = require("firebase-admin/app-check");
const crypto_1 = require("crypto");
const rateLimit_1 = require("../rateLimit");
// Token de App Check para el televisor del muelle (2026-09-22, al pasar App
// Check a enforcement). En la Samsung el reCAPTCHA no resuelve nunca, así que
// la tele no puede conseguir un token por el camino normal y con enforcement
// Firestore la dejaría afuera. La app en modo tele (ES_TELE) usa un
// CustomProvider de App Check que llama acá con la CLAVE de la tele (secret
// CLAVE_TELE, va en la URL de la tele una sola vez: ?claveTele=...) y el
// servidor le acuña un token de App Check con el Admin SDK, válido 7 días.
//
// Este callable NO exige App Check (si lo exigiera, la tele no podría pedir
// su primer token) ni sesión (la tele resuelve el login leyendo staffDniIndex,
// que ya es una lectura de Firestore). La defensa es la clave, comparada en
// tiempo constante, más un tope por IP.
exports.claveTele = (0, params_1.defineSecret)('CLAVE_TELE');
const APP_ID_RE = /^1:\d{6,}:web:[a-f0-9]{8,}$/;
// Siete días, el máximo que admite createToken (2026-09-24): la tele queda con
// la misma página abierta días enteros y el refresco automático del SDK no
// corrió cuando venció el token de 24 h; ahora la app lo renueva sola cada 5
// min cuando le quedan menos de 12 h (vigilarTokenTele en services/firebase.ts),
// y el TTL largo deja margen si un día ese pedido falla.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const hash = (s) => (0, crypto_1.createHash)('sha256').update(s).digest();
exports.tokenAppCheckTele = (0, https_1.onCall)({ secrets: [exports.claveTele], timeoutSeconds: 30 }, async (request) => {
    const ip = String(request.rawRequest.ip ?? request.rawRequest.headers['x-forwarded-for'] ?? 'sin-ip').split(',')[0].trim();
    await (0, rateLimit_1.assertRateLimit)(ip.replace(/[^0-9a-zA-Z.:]/g, '_'), 'tokenTele', 20, 3600);
    const clave = String(request.data?.clave ?? '');
    const appId = String(request.data?.appId ?? '');
    const esperada = exports.claveTele.value();
    if (!esperada || clave.length < 8 || !(0, crypto_1.timingSafeEqual)(hash(clave), hash(esperada))) {
        throw new https_1.HttpsError('permission-denied', 'Clave de la tele incorrecta');
    }
    if (!APP_ID_RE.test(appId))
        throw new https_1.HttpsError('invalid-argument', 'appId inválido');
    const { token, ttlMillis } = await (0, app_check_1.getAppCheck)().createToken(appId, { ttlMillis: TTL_MS });
    return { token, expireTimeMillis: Date.now() + ttlMillis };
});
//# sourceMappingURL=appCheckTele.js.map