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

import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { calcularRevision, normalizarUmbralFaltantes, type ItemContado } from '../services/revisionDescarga'

const TZ = 'America/Argentina/Buenos_Aires'

/** Rango [00:00, 24:00) del día argentino de una fecha. */
export function rangoDiaArgentino(d: Date): [Date, Date] {
  const dia = d.toLocaleDateString('en-CA', { timeZone: TZ })
  const desde = new Date(`${dia}T00:00:00-03:00`)
  const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000)
  return [desde, hasta]
}

export const onDescargaContada = onDocumentCreated(
  'descargasCamion/{descargaId}',
  async (event) => {
    const descarga = event.data?.data()
    if (!descarga) return
    const choferId = String(descarga.choferId ?? '')
    if (!choferId) return

    const db = getFirestore()
    const fecha: Date = descarga.fecha?.toDate?.() ?? new Date()
    const [desde, hasta] = rangoDiaArgentino(fecha)
    const del = (col: string, campo: string) => db.collection(col)
      .where(campo, '==', choferId)
      .where('fecha', '>=', Timestamp.fromDate(desde))
      .where('fecha', '<', Timestamp.fromDate(hasta))
      .get()

    try {
      // Entregas con remito de fábrica del día (orders.entregaFabrica, 2026-09-23):
      // sin venta de la app, pero bajaron del camión. Dos igualdades: sin índice.
      const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha)
      const [remitos, ventas, cambios, descargas, pedidosFabrica] = await Promise.all([
        del('remitosCarga', 'choferId'),
        del('ventasCamion', 'choferId'),
        del('cambiosCamion', 'choferId'),
        del('descargasCamion', 'choferId'),
        db.collection('orders').where('entregaFabrica.choferId', '==', choferId).where('entregaFabrica.dia', '==', dia).get(),
      ])

      const umbral = normalizarUmbralFaltantes(
        (await db.doc('config/liquidacion').get()).data()?.faltantes,
      )
      const r = calcularRevision(
        remitos.docs.map((d) => ({ items: (d.data().items ?? []) as ItemContado[] })),
        ventas.docs.map((d) => ({
          items:     (d.data().items ?? []) as ItemContado[],
          cambios:   (d.data().cambios ?? []) as ItemContado[],
          anulacion: d.data().anulacion ?? null,
        })),
        cambios.docs.map((d) => d.data() as ItemContado),
        // Todas las del día, incluida la que se acaba de crear: la liquidación
        // compara el teórico del día contra la SUMA de las descargas.
        descargas.docs.map((d) => ({
          id:         d.id,
          rectificaA: d.data().rectificaA as string | undefined,
          items:      (d.data().items ?? []) as ItemContado[],
        })),
        umbral,
        pedidosFabrica.docs.map((d) => ({ productos: (d.data().entregaFabrica?.productos ?? []) as ItemContado[] })),
      )

      await event.data!.ref.update({ revision: { ...r, calculadoEn: Timestamp.now() } })
    } catch (err) {
      // Nunca hacer ruido en el conteo: el faltante se vuelve a calcular en
      // vivo al liquidar. Si esto falla, la descarga queda sin marca.
      console.error('[descargaRevision] no se pudo calcular el faltante', event.params.descargaId, err)
    }
  },
)
