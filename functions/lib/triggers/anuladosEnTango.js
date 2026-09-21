"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificarAnuladosEnTango = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const authz_1 = require("../authz");
const rateLimit_1 = require("../rateLimit");
const anuladosEnTango_1 = require("../services/anuladosEnTango");
/**
 * "Preguntar a Tango ahora" (2026-09-20).
 *
 * Los remitos y recibos que la app anula salen de la lista de pendientes
 * cuando el lector ve el comprobante anulado en Tango, y eso corría una vez
 * por hora. Desde Comprobantes de clientes la oficina puede pedir la misma
 * pasada en el momento, después de que el bridge refresque los comprobantes
 * del cliente: así el que acaba de anularlo en Tango ve irse la fila en vez de
 * quedarse con la duda de si lo tomó.
 *
 * NO marca nada: corre exactamente la misma cuenta que el barrido horario. El
 * único que da por hecha una anulación sigue siendo Tango.
 */
exports.verificarAnuladosEnTango = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'No autenticado');
    (0, authz_1.assertNoImpersonado)(request);
    const db = (0, firestore_1.getFirestore)();
    const quien = (await db.collection('users').doc(request.auth.uid).get()).data();
    const roles = [String(quien?.rol ?? ''), ...(Array.isArray(quien?.rolesExtra) ? quien.rolesExtra.map(String) : [])];
    if (quien?.estado !== 'activo' || !roles.some((r) => ['facturacion', 'super_admin', 'tesoreria'].includes(r))) {
        throw new https_1.HttpsError('permission-denied', 'No podés verificar anulaciones en Tango');
    }
    // Son dos queries y unos pocos getAll: barato, pero no para apretarlo sin fin.
    await (0, rateLimit_1.assertRateLimit)(request.auth.uid, 'verificarAnuladosEnTango', 60, 3600);
    const [remitos, recibos] = await Promise.all([
        (0, anuladosEnTango_1.confirmarRemitosAnulados)(db),
        (0, anuladosEnTango_1.confirmarRecibosAnulados)(db),
    ]);
    return { remitos, recibos };
});
//# sourceMappingURL=anuladosEnTango.js.map