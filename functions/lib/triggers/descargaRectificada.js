"use strict";
/**
 * Un conteo de descarga rectificado (2026-09-13, paso 8 del control de fugas).
 *
 * Muelle corrige un conteo mal cargado creando una descarga nueva que apunta a
 * la vieja (`rectificaA`). La app se corrige sola: la liquidación y el reparto
 * en vivo toman la corrección en lugar de la original
 * (utils/rectificacionDescarga.ts).
 *
 * **Tango NO se corrige solo, y hay que decirlo.** La descarga original ya
 * encoló la transferencia camión → planta, y la cola no tiene contra-movimiento
 * para `transferenciaDeposito`: ni un `buildError` que lo revierta ni un estado
 * "cancelado". Por eso la rectificación no se encola (ver tangoOutbox) y este
 * trigger avisa por push a facturación y al super_admin con el delta exacto,
 * igual que con los remitos que anula el chofer: el ajuste de stock lo hace la
 * oficina a mano.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onDescargaRectificada = void 0;
exports.ajusteDeStock = ajusteDeStock;
exports.avisoRectificacion = avisoRectificacion;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const push_1 = require("../services/push");
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
const TZ = 'America/Argentina/Buenos_Aires';
const diaArgentino = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const mapa = (items) => {
    const m = new Map();
    for (const i of items ?? []) {
        const id = String(i.productoId ?? '');
        if (!id)
            continue;
        const prev = m.get(id);
        m.set(id, { nombre: String(i.nombre ?? id), cantidad: (prev?.cantidad ?? 0) + Number(i.cantidad ?? 0) });
    }
    return m;
};
/**
 * El ajuste que hay que hacer en Tango: corrección − original, por producto.
 * Positivo = entró de menos al depósito de planta y hay que sumarlo; negativo =
 * entró de más y hay que restarlo. Pura.
 */
function ajusteDeStock(original, correccion) {
    const antes = mapa(original?.items);
    const ahora = mapa(correccion.items);
    const ids = new Set([...antes.keys(), ...ahora.keys()]);
    return [...ids]
        .map((id) => ({
        nombre: ahora.get(id)?.nombre ?? antes.get(id)?.nombre ?? id,
        delta: (ahora.get(id)?.cantidad ?? 0) - (antes.get(id)?.cantidad ?? 0),
    }))
        .filter((x) => x.delta !== 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
/**
 * Texto de la push a la oficina. Pura.
 *
 * `cierre` es el código de la liquidación de ese día si YA estaba cerrada: el
 * cierre es un snapshot y no se reabre (mismo criterio que las ventas anuladas
 * después de cerrar), así que la oficina tiene que saber que el número firmado
 * quedó con el conteo viejo.
 */
function avisoRectificacion(original, correccion, cierre) {
    const ajuste = ajusteDeStock(original, correccion);
    const detalle = ajuste.map((a) => `${a.nombre} ${a.delta > 0 ? '+' : ''}${a.delta}`).join(', ');
    const quien = String(correccion.registradoPor?.nombre ?? 'Muelle');
    return {
        titulo: `Conteo corregido: ajustar stock en Tango (${String(correccion.choferNombre ?? '')})`,
        cuerpo: `${quien} corrigió la descarga${correccion.remitoCodigo ? ` de ${String(correccion.remitoCodigo)}` : ''}`
            + `${correccion.depositoTango ? ` (depósito ${String(correccion.depositoTango)})` : ''}`
            + `${correccion.motivoRectificacion ? ` · ${String(correccion.motivoRectificacion)}` : ''}. `
            + `${detalle ? `Ajuste en Tango: ${detalle}.` : 'Las cantidades quedaron iguales.'} `
            + 'La app ya liquida con el conteo corregido; el stock hay que ajustarlo a mano.'
            + (cierre ? ` OJO: la liquidación ${cierre} de ese día ya estaba cerrada y no se reabre: quedó firmada con el conteo anterior.` : ''),
    };
}
exports.onDescargaRectificada = (0, firestore_1.onDocumentCreated)({ document: 'descargasCamion/{descargaId}', secrets: [vapidPublicKey, vapidPrivateKey] }, async (event) => {
    const correccion = event.data?.data();
    if (!correccion?.rectificaA)
        return;
    try {
        const db = (0, firestore_2.getFirestore)();
        // Si la liquidación de ese día ya se cerró, el aviso lo dice: el cierre
        // es un snapshot firmado y no se reabre.
        const fecha = correccion.fecha?.toDate?.() ?? new Date();
        const choferId = String(correccion.choferId ?? '');
        const [originalSnap, destinatarios, liquidacion] = await Promise.all([
            db.doc(`descargasCamion/${correccion.rectificaA}`).get(),
            db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get(),
            choferId ? db.doc(`liquidaciones/${diaArgentino(fecha)}_${choferId}`).get() : Promise.resolve(null),
        ]);
        const cerrada = liquidacion?.exists
            ? String(liquidacion.data()?.codigo ?? `del ${diaArgentino(fecha)}`)
            : null;
        const { titulo, cuerpo } = avisoRectificacion(originalSnap.data(), correccion, cerrada);
        await (0, push_1.enviarPushAUsuarios)(destinatarios.docs, { titulo, cuerpo, url: '/caja/liquidaciones' }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() });
    }
    catch (e) {
        console.error(`[rectificacion] push a la oficina falló: ${e.message}`);
    }
});
//# sourceMappingURL=descargaRectificada.js.map