"use strict";
/**
 * Avisos del faltante de mercadería a autorizar (2026-09-13, paso 7 del control
 * de fugas en expedición).
 *
 *   - onDesvioSolicitado: caja pide que alguien mire un faltante de la descarga
 *     → push a quienes tienen el permiso (mismo padrón que las anulaciones:
 *     users.autorizaAnulaciones). Caja no puede leer el directorio de usuarios,
 *     así que la push tiene que salir del server.
 *   - onDesvioResuelto: aprobado o rechazado → push a quien lo pidió, con la
 *     nota. Si fue rechazado la nota dice qué hacer, y es lo que el cajero
 *     necesita leer para seguir.
 *
 * No hay efecto sobre el stock ni sobre la liquidación: esto solo habilita el
 * camino limpio del cierre. Si nadie contesta, caja cierra con desvío observado.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onDesvioResuelto = exports.onDesvioSolicitado = void 0;
exports.avisoDesvio = avisoDesvio;
exports.avisoResolucion = avisoResolucion;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const push_1 = require("../services/push");
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
const claves = () => ({ vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() });
/** Texto de la push a los autorizantes. Pura. */
function avisoDesvio(d) {
    const productos = (d.productos ?? []).map((p) => `${String(p.nombre ?? '')} -${Number(p.faltan ?? 0)}`).join(', ');
    return {
        titulo: `Faltan ${Number(d.bolsasFaltantes ?? 0)} bolsas: ${String(d.choferNombre ?? 'un repartidor')}`,
        cuerpo: `${d.depositoTango ? `Depósito ${String(d.depositoTango)} · ` : ''}día ${String(d.fecha ?? '')}`
            + `${productos ? ` · ${productos}` : ''} · lo pidió ${String(d.solicitadoPor?.nombre ?? 'caja')}`
            + `${d.nota ? ` · ${String(d.nota)}` : ''}. Caja espera para cerrar.`,
    };
}
/** Texto de la push a quien pidió, ya resuelto. Pura. */
function avisoResolucion(d) {
    const aprobada = d.estado === 'aprobada';
    const quien = String(d.resueltaPor?.nombre ?? 'el autorizante');
    return {
        titulo: aprobada
            ? `Faltante autorizado: ${String(d.choferNombre ?? '')}`
            : `Faltante RECHAZADO: ${String(d.choferNombre ?? '')}`,
        cuerpo: aprobada
            ? `${quien} autorizó el cierre con ${Number(d.bolsasFaltantes ?? 0)} bolsas de menos${d.notaResolucion ? ` · ${String(d.notaResolucion)}` : ''}.`
            : `${quien}: ${String(d.notaResolucion ?? 'hay que revisarlo antes de cerrar')}`,
    };
}
exports.onDesvioSolicitado = (0, firestore_1.onDocumentCreated)({ document: 'desviosDescarga/{desvioId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const d = event.data?.data();
    if (!d || d.estado !== 'pendiente')
        return;
    try {
        const db = (0, firestore_2.getFirestore)();
        const autorizantes = await db.collection('users')
            .where('autorizaAnulaciones', '==', true)
            .where('estado', '==', 'activo')
            .get();
        await (0, push_1.enviarPushAUsuarios)(autorizantes.docs, { ...avisoDesvio(d), url: '/anulaciones' }, claves());
    }
    catch (e) {
        console.error(`[desvios] push a autorizantes falló: ${e.message}`);
    }
});
exports.onDesvioResuelto = (0, firestore_1.onDocumentUpdated)({ document: 'desviosDescarga/{desvioId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const antes = event.data?.before.data();
    const despues = event.data?.after.data();
    if (!despues || antes?.estado !== 'pendiente')
        return;
    if (despues.estado !== 'aprobada' && despues.estado !== 'rechazada')
        return;
    const uid = String(despues.solicitadoPor?.uid ?? '');
    if (!uid)
        return;
    try {
        const quien = await (0, firestore_2.getFirestore)().doc(`users/${uid}`).get();
        if (!quien.exists)
            return;
        await (0, push_1.enviarPushAUsuarios)([quien], { ...avisoResolucion(despues), url: '/caja/liquidaciones' }, claves());
    }
    catch (e) {
        console.error(`[desvios] push al cajero falló: ${e.message}`);
    }
});
//# sourceMappingURL=desviosDescarga.js.map