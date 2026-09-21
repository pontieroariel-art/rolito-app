"use strict";
/**
 * Anulación de un recibo de cobranza con autorización (2026-09-15, pedido de
 * Ariel: "un botón de anulación en la rendición y que autoricen los autorizados").
 *
 * Tres funciones sobre `anulacionesCobranza/{cobranzaId}`:
 *   - creada por el que cobró → se marca la cobranza como "anulación pendiente"
 *     (`cobranzas.anulacion`, que el cliente no puede escribir) y se avisa por
 *     push a los usuarios con `autorizaAnulaciones`.
 *   - aprobada / rechazada → se marca la cobranza anulada (o el rechazo) y se
 *     le avisa al que cobró, con "Hacer el recibo correcto". Si el recibo ya
 *     estaba en Tango, push a facturación para anularlo allá a mano.
 *   - cada hora, `reconciliarRecibosAnulados` confirma los que el lector de
 *     comprobantes ya ve anulados en Tango (GVA12.ESTADO 'ANU').
 *
 * Lógica pura y tests en services/anulacionCobranza.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconciliarRecibosAnulados = exports.onAnulacionReciboResuelta = exports.onAnulacionReciboSolicitada = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_2 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const push_1 = require("../services/push");
const anulacionCobranza_1 = require("../services/anulacionCobranza");
const anuladosEnTango_1 = require("../services/anuladosEnTango");
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
const claves = () => ({ vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() });
async function avisarUsuario(uid, titulo, cuerpo, url) {
    if (typeof uid !== 'string' || !uid)
        return;
    const db = (0, firestore_2.getFirestore)();
    const doc = await db.doc(`users/${uid}`).get();
    if (!doc.exists)
        return;
    await (0, push_1.enviarPushAUsuarios)([doc], { titulo, cuerpo, url }, claves());
}
async function avisarAutorizantes(a) {
    const db = (0, firestore_2.getFirestore)();
    const autorizantes = await db.collection('users').where('autorizaAnulaciones', '==', true).where('estado', '==', 'activo').get();
    const { titulo, cuerpo } = (0, anulacionCobranza_1.avisoSolicitudRecibo)(a);
    await (0, push_1.enviarPushAUsuarios)(autorizantes.docs, { titulo, cuerpo, url: '/anulaciones' }, claves());
}
exports.onAnulacionReciboSolicitada = (0, firestore_1.onDocumentCreated)({ document: 'anulacionesCobranza/{cobranzaId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const a = event.data?.data();
    if (!a || a.estado !== 'pendiente')
        return;
    const cobranzaId = event.params.cobranzaId;
    await (0, firestore_2.getFirestore)().doc(`cobranzas/${cobranzaId}`).set({ anulacion: { estado: 'pendiente', solicitudId: cobranzaId } }, { merge: true });
    try {
        await avisarAutorizantes(a);
    }
    catch (e) {
        console.error(`[anulacionRecibo] push a autorizantes falló: ${e.message}`);
    }
});
exports.onAnulacionReciboResuelta = (0, firestore_1.onDocumentUpdated)({ document: 'anulacionesCobranza/{cobranzaId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const antes = event.data?.before.data();
    const despues = event.data?.after.data();
    const cobranzaId = event.params.cobranzaId;
    const transicion = (0, anulacionCobranza_1.transicionRecibo)(antes, despues);
    if (!transicion || !despues)
        return;
    const db = (0, firestore_2.getFirestore)();
    const cobranza = db.doc(`cobranzas/${cobranzaId}`);
    if (transicion === 'resolicitar') {
        await cobranza.set({ anulacion: { estado: 'pendiente', solicitudId: cobranzaId } }, { merge: true });
        try {
            await avisarAutorizantes(despues);
        }
        catch (e) {
            console.error(`[anulacionRecibo] push falló: ${e.message}`);
        }
        return;
    }
    if (transicion === 'rechazar') {
        await cobranza.set({ anulacion: { estado: 'rechazada', solicitudId: cobranzaId } }, { merge: true });
        try {
            await avisarUsuario(despues.solicitadoPor?.uid, 'Anulación de recibo rechazada', `${String(despues.resueltaPor?.nombre ?? 'Quien autoriza')} no aprobó anular el recibo ${String(despues.numeroRecibo ?? '')}${despues.notaResolucion ? `: ${String(despues.notaResolucion)}` : ''}. El recibo sigue vigente.`, (0, anulacionCobranza_1.urlDelCobrador)(despues));
        }
        catch (e) {
            console.error(`[anulacionRecibo] push al cobrador falló: ${e.message}`);
        }
        return;
    }
    // 'anular': la cobranza deja de contar en todos lados. El doc de la cobranza
    // es inmutable para el cliente; acá escribe el Admin SDK (misma vía que el
    // write-back de Tango). Reemplaza el mapa entero, no lo mezcla.
    const marca = (0, anulacionCobranza_1.marcaAnulada)(despues, cobranzaId, firestore_2.FieldValue.serverTimestamp());
    await cobranza.update({ anulacion: marca });
    const enTango = typeof despues.reciboTango === 'string' && despues.reciboTango.trim() !== '';
    await event.data.after.ref.set({ tango: { estado: enTango ? 'pendiente_oficina' : 'no_aplica' } }, { merge: true });
    try {
        await avisarUsuario(despues.solicitadoPor?.uid, 'Recibo anulado', `Se anuló el recibo ${String(despues.numeroRecibo ?? '')} de ${String(despues.clienteNombre ?? '')} (${(0, anulacionCobranza_1.motivoLegible)(despues.motivo)}). Ya no cuenta en tu rendición. Tocá para hacer el recibo correcto.`, (0, anulacionCobranza_1.urlReemitirRecibo)(despues, cobranzaId));
    }
    catch (e) {
        console.error(`[anulacionRecibo] push al cobrador falló: ${e.message}`);
    }
    if (enTango) {
        try {
            const oficina = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get();
            const { titulo, cuerpo } = (0, anulacionCobranza_1.avisoAnularEnTango)(despues);
            await (0, push_1.enviarPushAUsuarios)(oficina.docs, { titulo, cuerpo, url: '/admin/comprobantes' }, claves());
        }
        catch (e) {
            console.error(`[anulacionRecibo] push a facturación falló: ${e.message}`);
        }
    }
});
/**
 * Cada hora: los recibos anulados en la app que la oficina tenía que anular en
 * Tango pasan a 'confirmado' cuando el lector de comprobantes los ve con ESTADO
 * 'ANU' en el índice del cliente (`tangoComprobantes/{empresa}_{codigo}`).
 */
exports.reconciliarRecibosAnulados = (0, scheduler_1.onSchedule)({ schedule: 'every 60 minutes', timeZone: 'America/Argentina/Buenos_Aires' }, async () => {
    const { pendientes, confirmados } = await (0, anuladosEnTango_1.confirmarRecibosAnulados)((0, firestore_2.getFirestore)());
    console.log(`[recibos] anulados pendientes en Tango: ${pendientes}, confirmados ahora: ${confirmados}`);
});
//# sourceMappingURL=anulacionesCobranza.js.map