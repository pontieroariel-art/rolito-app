"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onProduccionPalletAnulado = void 0;
exports.accionAnulacionPallet = accionAnulacionPallet;
exports.avisoPalletAnulado = avisoPalletAnulado;
/**
 * Pallet de producción anulado por el encargado (2026-09-25).
 *
 * Cada pallet viaja a Tango como un ingreso propio (PDT en Torcuato, PRO en
 * Merlo) apenas se carga. Si el encargado lo anula:
 *   - y todavía no salió (la cola está pendiente o en error): se descarta el
 *     item de la cola, así Tango nunca se entera;
 *   - y ya salió o está saliendo: el ingreso quedó en Tango y lo tiene que
 *     anular la oficina a mano. Se anota en el item de la cola y se avisa por
 *     push a facturación y al super_admin, igual que con los remitos anulados.
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const push_1 = require("../services/push");
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
/** Qué hacer con el item de la cola de un pallet que se acaba de anular. Pura. */
function accionAnulacionPallet(estadoCola) {
    if (!estadoCola)
        return 'nada'; // nunca se encoló
    if (estadoCola === 'pendiente' || estadoCola === 'error')
        return 'descartar';
    if (estadoCola === 'descartado')
        return 'nada';
    return 'avisarOficina'; // enviado / confirmado
}
/** Texto de la push a la oficina. Pura. */
function avisoPalletAnulado(p, numeroTango) {
    return {
        titulo: `Anular en Tango la producción del pallet ${p.codigo ?? ''}`.trim(),
        cuerpo: [
            `${p.unidades ?? '?'} × ${p.productoNombre ?? 'producto'}`,
            numeroTango ? `comprobante ${numeroTango.trim()}` : 'el comprobante todavía se está grabando',
            `anuló ${p.anulacion?.por?.nombre ?? 'el encargado'}: ${p.anulacion?.motivo ?? ''}`.trim(),
        ].join(' · '),
    };
}
exports.onProduccionPalletAnulado = (0, firestore_1.onDocumentUpdated)({ document: 'produccionPallets/{palletId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const antes = event.data?.before.data();
    const despues = event.data?.after.data();
    if (!despues || antes?.anulacion || !despues.anulacion)
        return;
    const db = (0, firestore_2.getFirestore)();
    const colaRef = db.doc(`tango-outbox/produccionPallets_${event.params.palletId}`);
    const cola = await colaRef.get();
    const estado = cola.exists ? cola.data()?.estado : null;
    const accion = accionAnulacionPallet(estado);
    if (accion === 'descartar') {
        // Condición: que siga sin salir. Si el bridge lo tomó en el medio, se trata como enviado.
        const descartado = await db.runTransaction(async (tx) => {
            const snap = await tx.get(colaRef);
            const e = snap.data()?.estado;
            if (e !== 'pendiente' && e !== 'error')
                return false;
            tx.update(colaRef, { estado: 'descartado', ultimoError: 'pallet anulado en la app antes de ir a Tango', actualizadoEn: firestore_2.FieldValue.serverTimestamp() });
            return true;
        });
        if (descartado)
            return;
    }
    else if (accion === 'nada') {
        return;
    }
    const resultado = (await colaRef.get()).data()?.resultado;
    await colaRef.set({ anulacionApp: { estado: 'pendiente_oficina', en: firestore_2.FieldValue.serverTimestamp() } }, { merge: true });
    try {
        const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get();
        const { titulo, cuerpo } = avisoPalletAnulado(despues, resultado?.produccionNumero ?? null);
        await (0, push_1.enviarPushAUsuarios)(destinatarios.docs, { titulo, cuerpo, url: '/produccion/listado' }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() });
    }
    catch (e) {
        console.error(`[produccion] push de pallet anulado falló: ${e.message}`);
    }
});
//# sourceMappingURL=produccionAnulada.js.map