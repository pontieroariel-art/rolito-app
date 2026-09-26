"use strict";
/**
 * Marca el faltante de una descarga contada (2026-09-13, control de fugas).
 *
 * Muelle cuenta A CIEGAS: las reglas no le dejan leer `ventasCamion` y la tablet
 * nunca ve el teórico, ni antes ni después de registrar. Entonces el faltante lo
 * calcula ACÁ, al crearse la descarga: se reúne el día del chofer (remitos de
 * carga, ventas, cambios viejos, todas sus descargas) y se escribe
 * `descargasCamion.revision` con lo que falta y si pasa el umbral de
 * `config/liquidacion.faltantes`.
 *
 * Es la FOTO DEL MOMENTO DEL CONTEO, no el veredicto: si el chofer venía sin
 * señal y sube ventas después, este faltante queda inflado. Lo que traba el
 * cierre es el recálculo en vivo de caja, con todas las ventas a la vista. Esta
 * marca es la de auditoría (queda escrito qué se vio al contar) y la que
 * dispara el aviso.
 *
 * Va aparte de `onDescargaCamionCreada` (tangoOutbox) a propósito: si este
 * cálculo falla, la transferencia de stock a Tango se encola igual.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onDescargaContada = void 0;
exports.rangoDiaArgentino = rangoDiaArgentino;
const entregaFabricaTope_1 = require("../services/entregaFabricaTope");
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const revisionDescarga_1 = require("../services/revisionDescarga");
const TZ = 'America/Argentina/Buenos_Aires';
/** Rango [00:00, 24:00) del día argentino de una fecha. */
function rangoDiaArgentino(d) {
    const dia = d.toLocaleDateString('en-CA', { timeZone: TZ });
    const desde = new Date(`${dia}T00:00:00-03:00`);
    const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000);
    return [desde, hasta];
}
exports.onDescargaContada = (0, firestore_1.onDocumentCreated)('descargasCamion/{descargaId}', async (event) => {
    const descarga = event.data?.data();
    if (!descarga)
        return;
    const choferId = String(descarga.choferId ?? '');
    if (!choferId)
        return;
    const db = (0, firestore_2.getFirestore)();
    const fecha = descarga.fecha?.toDate?.() ?? new Date();
    const [desde, hasta] = rangoDiaArgentino(fecha);
    const del = (col, campo) => db.collection(col)
        .where(campo, '==', choferId)
        .where('fecha', '>=', firestore_2.Timestamp.fromDate(desde))
        .where('fecha', '<', firestore_2.Timestamp.fromDate(hasta))
        .get();
    try {
        // Entregas con remito de fábrica del día (orders.entregaFabrica, 2026-09-23):
        // sin venta de la app, pero bajaron del camión. Dos igualdades: sin índice.
        const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
        const [remitos, ventas, cambios, descargas, pedidosFabrica] = await Promise.all([
            del('remitosCarga', 'choferId'),
            del('ventasCamion', 'choferId'),
            del('cambiosCamion', 'choferId'),
            del('descargasCamion', 'choferId'),
            db.collection('orders').where('entregaFabrica.choferId', '==', choferId).where('entregaFabrica.dia', '==', dia).get(),
        ]);
        const umbral = (0, revisionDescarga_1.normalizarUmbralFaltantes)((await db.doc('config/liquidacion').get()).data()?.faltantes);
        const r = (0, revisionDescarga_1.calcularRevision)(remitos.docs.map((d) => ({ items: (d.data().items ?? []) })), ventas.docs.map((d) => ({
            items: (d.data().items ?? []),
            cambios: (d.data().cambios ?? []),
            anulacion: d.data().anulacion ?? null,
        })), cambios.docs.map((d) => d.data()), 
        // Todas las del día, incluida la que se acaba de crear: la liquidación
        // compara el teórico del día contra la SUMA de las descargas.
        descargas.docs.map((d) => ({
            id: d.id,
            rectificaA: d.data().rectificaA,
            items: (d.data().items ?? []),
        })), umbral, 
        // Topeado a lo pedido (2026-09-26, auditoría del chofer, C4).
        pedidosFabrica.docs.map((d) => ({ productos: (0, entregaFabricaTope_1.productosFabricaTopeados)(d.data().products, d.data().entregaFabrica?.productos).productos })));
        await event.data.ref.update({ revision: { ...r, calculadoEn: firestore_2.Timestamp.now() } });
    }
    catch (err) {
        // Nunca hacer ruido en el conteo: el faltante se vuelve a calcular en
        // vivo al liquidar. Si esto falla, la descarga queda sin marca.
        console.error('[descargaRevision] no se pudo calcular el faltante', event.params.descargaId, err);
    }
});
//# sourceMappingURL=descargaRevision.js.map