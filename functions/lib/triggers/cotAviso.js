"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onCotError = void 0;
exports.cotPasoAError = cotPasoAError;
exports.avisoCotError = avisoCotError;
/**
 * Aviso cuando el COT de un remito de carga queda en error (2026-09-22).
 *
 * Entre el 21 y el 22/09 rebotaron 11 de 11 COT a clientes y nadie se enteró:
 * el error quedaba en `remitosCarga.cot.error` y el tile del panel de control
 * lo contaba, pero nadie lo miró. Un camión que sale sin COT es una multa en la
 * ruta. Cada vez que `cot.estado` pasa a 'error' (primera vez o error nuevo)
 * se avisa por push a caja, logística y super_admin con el remito y el motivo;
 * la pantalla de remitos tiene el botón para reintentar.
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const push_1 = require("../services/push");
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
/** ¿Hay que avisar? Solo cuando el error aparece o cambia (no en cada reintento con el mismo mensaje). Pura. */
function cotPasoAError(antes, ahora) {
    if (ahora?.cot?.estado !== 'error')
        return false;
    if (antes?.cot?.estado !== 'error')
        return true;
    return String(antes.cot.error ?? '') !== String(ahora.cot.error ?? '');
}
function avisoCotError(r) {
    const kg = typeof r.kg === 'number' ? ` · ${r.kg.toLocaleString('es-AR')} kg` : '';
    return {
        titulo: `COT rechazado: ${String(r.codigo ?? 'remito')}`,
        cuerpo: `${String(r.choferNombre ?? '')} · ${String(r.camionLabel ?? '')}${kg}. ARBA respondió: ${String(r.cot?.error ?? 'error').slice(0, 160)} Reintentá desde Remitos de carga.`,
    };
}
exports.onCotError = (0, firestore_1.onDocumentUpdated)({ document: 'remitosCarga/{remitoId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const antes = event.data?.before.data();
    const ahora = event.data?.after.data();
    if (!cotPasoAError(antes, ahora))
        return;
    const db = (0, firestore_2.getFirestore)();
    console.error(`[cot] ${String(ahora?.codigo ?? event.params.remitoId)} en error: ${String(ahora?.cot?.error ?? '')}`);
    try {
        const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['caja', 'logistica', 'super_admin']).get();
        await (0, push_1.enviarPushAUsuarios)(destinatarios.docs, { ...avisoCotError(ahora), url: '/caja/remitos' }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() });
    }
    catch (e) {
        console.error(`[cot] push del error falló: ${e.message}`);
    }
});
//# sourceMappingURL=cotAviso.js.map