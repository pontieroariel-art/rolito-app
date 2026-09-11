"use strict";
// Depósitos de Tango → app. Corrida diaria a la madrugada (después de precios)
// + callable para el botón "Sincronizar ahora" del panel de depósitos.
// Lógica en services/tango/depositos.ts; docs/tango/INTEGRACION.md §27.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sincronizarDepositosTangoAhora = exports.syncDepositosTango = void 0;
const https_1 = require("firebase-functions/v2/https");
const authz_1 = require("../authz");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const params_1 = require("firebase-functions/params");
const v2_1 = require("firebase-functions/v2");
const firestore_1 = require("firebase-admin/firestore");
const client_1 = require("../services/tango/client");
const depositos_1 = require("../services/tango/depositos");
const rateLimit_1 = require("../rateLimit");
const tangoApiToken = (0, params_1.defineSecret)('TANGO_API_TOKEN');
const CONNECT_BASE_URL_DEFAULT = 'https://001174-003.connect.axoft.com';
const TZ = 'America/Argentina/Buenos_Aires';
const ROLES_QUE_SINCRONIZAN = new Set(['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'caja']);
async function correr(origen, uid) {
    const db = (0, firestore_1.getFirestore)();
    const cfg = ((await db.doc('config/tango').get()).data() ?? {});
    if (cfg.enabled !== true)
        throw new https_1.HttpsError('failed-precondition', 'config/tango.enabled está apagado');
    const tango = new client_1.TangoClient({ baseUrl: cfg.connectBaseUrl ?? CONNECT_BASE_URL_DEFAULT, token: tangoApiToken.value(), timeoutMs: 60000 });
    const inicio = Date.now();
    const resumen = await (0, depositos_1.sincronizarDepositosTango)(db, tango, cfg);
    await db.doc('config/tango').set({
        depositosSync: { ultimaCorrida: firestore_1.FieldValue.serverTimestamp(), origen, uid: uid ?? null, duracionMs: Date.now() - inicio, resumen },
    }, { merge: true });
    v2_1.logger.info(`[tango] depósitos sincronizados (${origen}) en ${Date.now() - inicio}ms: ${JSON.stringify(resumen)}`);
    return resumen;
}
exports.syncDepositosTango = (0, scheduler_1.onSchedule)({ schedule: '40 5 * * *', timeZone: TZ, secrets: [tangoApiToken], timeoutSeconds: 300, memory: '512MiB' }, async () => {
    try {
        await correr('programada');
    }
    catch (e) {
        v2_1.logger.error(`[tango] sync de depósitos falló: ${e.message}`);
    }
});
exports.sincronizarDepositosTangoAhora = (0, https_1.onCall)({ secrets: [tangoApiToken], timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'No autenticado');
    (0, authz_1.assertNoImpersonado)(request);
    const caller = (await (0, firestore_1.getFirestore)().collection('users').doc(request.auth.uid).get()).data();
    if (!caller || !ROLES_QUE_SINCRONIZAN.has(String(caller.rol)))
        throw new https_1.HttpsError('permission-denied', 'No tenés permiso para sincronizar depósitos');
    await (0, rateLimit_1.assertRateLimit)(request.auth.uid, 'sincronizarDepositosTango', 3, 300);
    return correr('manual', request.auth.uid);
});
//# sourceMappingURL=tangoDepositos.js.map