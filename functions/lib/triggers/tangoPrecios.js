"use strict";
// Precios y listas: Tango → app. Corrida diaria a la madrugada (igual que
// clientes) + callable para el botón "Sincronizar ahora" de la pantalla de
// precios. Lógica en services/tango/precios.ts; docs/tango/INTEGRACION.md §17.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sincronizarPreciosTangoAhora = exports.syncPreciosTango = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const params_1 = require("firebase-functions/params");
const v2_1 = require("firebase-functions/v2");
const firestore_1 = require("firebase-admin/firestore");
const client_1 = require("../services/tango/client");
const precios_1 = require("../services/tango/precios");
const rateLimit_1 = require("../rateLimit");
const tangoApiToken = (0, params_1.defineSecret)('TANGO_API_TOKEN');
const CONNECT_BASE_URL_DEFAULT = 'https://001174-003.connect.axoft.com';
const TZ = 'America/Argentina/Buenos_Aires';
const ROLES_QUE_SINCRONIZAN = new Set(['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion']);
async function correr(origen, uid) {
    const db = (0, firestore_1.getFirestore)();
    const cfg = ((await db.doc('config/tango').get()).data() ?? {});
    if (cfg.enabled !== true)
        throw new https_1.HttpsError('failed-precondition', 'config/tango.enabled está apagado');
    const tango = new client_1.TangoClient({ baseUrl: cfg.connectBaseUrl ?? CONNECT_BASE_URL_DEFAULT, token: tangoApiToken.value(), timeoutMs: 60000 });
    const inicio = Date.now();
    const resumen = await (0, precios_1.sincronizarPreciosTango)(db, tango, cfg);
    await db.doc('config/tango').set({
        preciosSync: { ultimaCorrida: firestore_1.FieldValue.serverTimestamp(), origen, uid: uid ?? null, duracionMs: Date.now() - inicio, resumen },
    }, { merge: true });
    v2_1.logger.info(`[tango] precios sincronizados (${origen}) en ${Date.now() - inicio}ms: ${JSON.stringify(resumen)}`);
    return resumen;
}
exports.syncPreciosTango = (0, scheduler_1.onSchedule)({ schedule: '30 5 * * *', timeZone: TZ, secrets: [tangoApiToken], timeoutSeconds: 540, memory: '512MiB' }, async () => {
    try {
        await correr('programada');
    }
    catch (e) {
        v2_1.logger.error(`[tango] sync de precios falló: ${e.message}`);
    }
});
exports.sincronizarPreciosTangoAhora = (0, https_1.onCall)({ secrets: [tangoApiToken], timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'No autenticado');
    const caller = (await (0, firestore_1.getFirestore)().collection('users').doc(request.auth.uid).get()).data();
    if (!caller || !ROLES_QUE_SINCRONIZAN.has(String(caller.rol)))
        throw new https_1.HttpsError('permission-denied', 'No tenés permiso para sincronizar precios');
    await (0, rateLimit_1.assertRateLimit)(request.auth.uid, 'sincronizarPreciosTango', 3, 300);
    return correr('manual', request.auth.uid);
});
//# sourceMappingURL=tangoPrecios.js.map