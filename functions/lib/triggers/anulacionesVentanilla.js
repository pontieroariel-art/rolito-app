"use strict";
/**
 * Anulación de facturas con nota de crédito (2026-09-09; camión desde el
 * 2026-09-11).
 *
 * Dos triggers sobre `anulacionesVentanilla/{ventaId}` (la colección conserva
 * el nombre; `coleccion` dice si la venta es de ventanilla o del camión):
 *   - creada por el cajero → se marca la venta como "anulación pendiente" y se
 *     avisa por push a los usuarios con permiso para autorizar
 *     (`users.autorizaAnulaciones`). Server-side porque caja no puede leer el
 *     directorio de usuarios ni disparar push a otros.
 *   - aprobada / rechazada por un autorizante → se emite la NC en ARCA (o se
 *     refleja el rechazo) y se le avisa al cajero que la pidió (y al chofer,
 *     si la factura es del camión).
 *
 * Los errores de emisión NO se relanzan (igual que en la facturación): un
 * reintento del trigger no arregla una causa permanente; la reconciliación
 * horaria de `reconciliarFacturasArca` es la que reintenta con criterio.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onAnulacionResuelta = exports.onAnulacionSolicitada = void 0;
exports.avisoSolicitud = avisoSolicitud;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const puertoFirebase_1 = require("../services/arca/puertoFirebase");
const anulacionVentanilla_1 = require("../services/arca/anulacionVentanilla");
const push_1 = require("../services/push");
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
const claves = () => ({ vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() });
const pesos = (n) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Texto de la push a los autorizantes. Pura. */
function avisoSolicitud(a, venta) {
    const cliente = String(venta?.clienteNombre ?? 'cliente');
    const total = Number(venta?.total ?? 0);
    const camion = (0, anulacionVentanilla_1.coleccionDeAnulacion)(a) === 'ventasCamion';
    return {
        titulo: a.origen === 'facturacion' ? 'Anulación de una factura de un día ya cerrado por autorizar' : camion ? 'Anulación de factura del camión por autorizar' : 'Anulación de factura por autorizar',
        cuerpo: `${cliente} · ${pesos(total)}${camion && venta?.choferNombre ? ` · chofer ${String(venta.choferNombre)}` : ''} · ${a.motivo}${a.nota ? ` · ${a.nota}` : ''} (pidió ${a.solicitadoPor?.nombre ?? 'caja'})`,
    };
}
/** A dónde vuelve el que pidió: la ventanilla, la liquidación del chofer o, si pidió facturación, la ficha del cliente. */
const urlDelSolicitante = (a) => a.origen === 'facturacion' ? `/admin/comprobantes${a.clienteId ? `?cliente=${a.clienteId}` : ''}`
    : (0, anulacionVentanilla_1.coleccionDeAnulacion)(a) === 'ventasCamion' ? '/caja/liquidaciones' : '/caja/ventanilla';
async function avisarAutorizantes(a, ventaId) {
    const db = (0, firestore_2.getFirestore)();
    const [autorizantes, venta] = await Promise.all([
        db.collection('users').where('autorizaAnulaciones', '==', true).where('estado', '==', 'activo').get(),
        db.doc(`${(0, anulacionVentanilla_1.coleccionDeAnulacion)(a)}/${ventaId}`).get(),
    ]);
    const { titulo, cuerpo } = avisoSolicitud(a, venta.data());
    await (0, push_1.enviarPushAUsuarios)(autorizantes.docs, { titulo, cuerpo, url: '/anulaciones' }, claves());
}
async function avisarUsuario(uid, titulo, cuerpo, url) {
    if (!uid)
        return;
    const db = (0, firestore_2.getFirestore)();
    const doc = await db.doc(`users/${uid}`).get();
    if (!doc.exists)
        return;
    await (0, push_1.enviarPushAUsuarios)([doc], { titulo, cuerpo, url }, claves());
}
/** Al que pidió y, si es del camión, también al chofer (lo ve en Mis ventas). */
async function avisarInteresados(a, titulo, cuerpo) {
    try {
        await avisarUsuario(a.solicitadoPor?.uid, titulo, cuerpo, urlDelSolicitante(a));
    }
    catch (e) {
        console.error(`[anulaciones] push al cajero falló: ${e.message}`);
    }
    const choferId = a.choferId;
    if ((0, anulacionVentanilla_1.coleccionDeAnulacion)(a) === 'ventasCamion' && choferId && choferId !== a.solicitadoPor?.uid) {
        try {
            await avisarUsuario(choferId, titulo, cuerpo, '/chofer/ventas');
        }
        catch (e) {
            console.error(`[anulaciones] push al chofer falló: ${e.message}`);
        }
    }
}
exports.onAnulacionSolicitada = (0, firestore_1.onDocumentCreated)({ document: 'anulacionesVentanilla/{ventaId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const a = event.data?.data();
    if (!a || a.estado !== 'pendiente')
        return;
    const ventaId = event.params.ventaId;
    const db = (0, firestore_2.getFirestore)();
    await db.doc(`${(0, anulacionVentanilla_1.coleccionDeAnulacion)(a)}/${ventaId}`).set({ anulacion: { estado: 'pendiente', solicitudId: ventaId } }, { merge: true });
    try {
        await avisarAutorizantes(a, ventaId);
    }
    catch (e) {
        console.error(`[anulaciones] push a autorizantes falló: ${e.message}`);
    }
});
exports.onAnulacionResuelta = (0, firestore_1.onDocumentUpdated)({ document: 'anulacionesVentanilla/{ventaId}', secrets: [puertoFirebase_1.arcaCert, puertoFirebase_1.arcaKey, vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const antes = event.data?.before.data();
    const despues = event.data?.after.data();
    const ventaId = event.params.ventaId;
    const db = (0, firestore_2.getFirestore)();
    const transicion = (0, anulacionVentanilla_1.transicionAnulacion)(antes, despues);
    if (!transicion || !despues)
        return;
    const coleccion = (0, anulacionVentanilla_1.coleccionDeAnulacion)(despues);
    if (transicion === 'resolicitar') {
        await db.doc(`${coleccion}/${ventaId}`).set({ anulacion: { estado: 'pendiente', solicitudId: ventaId } }, { merge: true });
        try {
            await avisarAutorizantes(despues, ventaId);
        }
        catch (e) {
            console.error(`[anulaciones] push falló: ${e.message}`);
        }
        return;
    }
    if (transicion === 'rechazar') {
        await (0, anulacionVentanilla_1.reflejarRechazoEnVenta)(db, ventaId, coleccion);
        await avisarInteresados(despues, 'Anulación rechazada', `${despues.resueltaPor?.nombre ?? 'Quien autoriza'} no aprobó la anulación${despues.notaResolucion ? `: ${despues.notaResolucion}` : ''}. La factura sigue vigente.`);
        return;
    }
    // 'emitir'
    // Antes de tocar ARCA, reflejar que ya no está pendiente (la venta no se
    // anula hasta tener el CAE de la NC).
    await db.doc(`${coleccion}/${ventaId}`).set({ anulacion: { estado: 'aprobada', solicitudId: ventaId } }, { merge: true });
    let registro = null;
    try {
        registro = await (0, anulacionVentanilla_1.emitirNotaCreditoDeAnulacion)(db, ventaId);
    }
    catch (e) {
        const motivo = e.message;
        console.error(`[anulaciones] no se pudo emitir la NC de ${ventaId}: ${motivo}`);
        await (0, anulacionVentanilla_1.registrarErrorPrevio)(db, ventaId, motivo, coleccion).catch(() => { });
        return;
    }
    if (registro?.estado === 'emitida') {
        await avisarInteresados(despues, 'Factura anulada', `Salió la nota de crédito ${String(registro.puntoVenta).padStart(5, '0')}-${String(registro.numero).padStart(8, '0')}. ${coleccion === 'ventasCamion' ? 'La venta ya no cuenta en la liquidación; si el cliente se quedó con la mercadería, registrá la venta correcta.' : 'Ya podés hacer la factura correcta.'}`);
    }
});
//# sourceMappingURL=anulacionesVentanilla.js.map