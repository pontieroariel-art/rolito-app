/**
 * Qué pasa del lado del server cuando una venta queda anulada (2026-09-11).
 *
 *   - onVentaCamionAnulada / onVentaVentanillaAnulada: al pasar la venta a
 *     `anulacion.estado = 'anulada'` (NC de ARCA, NC X de promo o remito
 *     anulado), si el cierre de ese día ya existía (liquidación del repartidor
 *     o cierre de caja) se le anota la anulación: el cierre NO se reabre
 *     (decisión de Ariel), queda con la nota para tesorería y la oficina.
 *     Además, si es un remito de cuenta corriente anulado (por el chofer en la
 *     calle o por facturación en la oficina), marca `anulacion.tango =
 *     pendiente_oficina` y avisa por push a facturación (y al super_admin)
 *     con el número de remito a anular en Tango. Camino A: la app saca la
 *     venta de la liquidación y del stock del camión; el remito en Tango lo
 *     anula la oficina a mano, como hasta hoy.
 *   - reconciliarRemitosAnulados (cada hora): mira el índice de comprobantes
 *     de Tango que publica el lector de la VM (tangoComprobantes) y, cuando el
 *     remito figura con ESTADO_MOV 'A', deja `anulacion.tango = confirmado`.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { enviarPushAUsuarios } from '../services/push'
import { anotarAnulacionPosterior } from '../services/anulacionesPosteriores'

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

interface AnulacionRemito { tipo?: string; estado?: string; motivo?: string; nota?: string; anuladaPor?: { nombre?: string }; tango?: { estado?: string } }

/** Texto de la push a facturación. Pura. */
export function avisoRemitoAnulado(venta: { clienteNombre?: unknown; choferNombre?: unknown; tango?: { remitoNumero?: unknown } | null; comprobanteInterno?: { puntoVenta?: number; numero?: number } | null }, a: AnulacionRemito): { titulo: string; cuerpo: string } {
  const ci = venta.comprobanteInterno
  const numero = String(venta.tango?.remitoNumero ?? (ci ? `${String(ci.puntoVenta ?? 0).padStart(5, '0')}-${String(ci.numero ?? 0).padStart(8, '0')}` : 'sin número'))
  const quien = a.anuladaPor?.nombre ?? String(venta.choferNombre ?? 'Chofer')
  return {
    titulo: 'Remito anulado en la app: anularlo en Tango',
    cuerpo: `${quien} anuló el remito ${numero} de ${String(venta.clienteNombre ?? 'cliente')} · ${a.motivo ?? ''}${a.nota ? ` · ${a.nota}` : ''}. Hay que anularlo en Tango.`,
  }
}

const recienAnulada = (antes: { estado?: string } | undefined, ahora: { estado?: string } | undefined): boolean =>
  ahora?.estado === 'anulada' && antes?.estado !== 'anulada'

/** Cuántos remitos anuló ese chofer en el día de la venta (índice choferId + fecha; el tipo se filtra en memoria). */
async function anulacionesDeRemitoHoy(db: FirebaseFirestore.Firestore, choferId: string, fecha: { toDate?: () => Date } | undefined): Promise<number> {
  const dia = fecha?.toDate?.()
  if (!choferId || !dia) return 0
  const desde = new Date(dia); desde.setUTCHours(3, 0, 0, 0)          // 00:00 en Argentina (UTC-3)
  if (desde > dia) desde.setUTCDate(desde.getUTCDate() - 1)
  const hasta = new Date(desde); hasta.setUTCDate(hasta.getUTCDate() + 1)
  const snap = await db.collection('ventasCamion').where('choferId', '==', choferId).where('fecha', '>=', desde).where('fecha', '<', hasta).get()
  return snap.docs.filter((d) => (d.data().anulacion as { tipo?: string; estado?: string } | undefined)?.tipo === 'remito' && d.data().anulacion?.estado === 'anulada').length
}

export const onVentaCamionAnulada = onDocumentUpdated(
  { document: 'ventasCamion/{ventaId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const antes = event.data?.before.data()?.anulacion as AnulacionRemito | undefined
    const ahora = event.data?.after.data()
    const a = ahora?.anulacion as AnulacionRemito | undefined
    if (!ahora || !a || !recienAnulada(antes, a)) return
    const db = getFirestore()
    const ventaId = event.params.ventaId

    if (a.tipo === 'remito') {
      await event.data!.after.ref.set({ anulacion: { tango: { estado: 'pendiente_oficina' } } }, { merge: true })
      try {
        const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get()
        const { titulo, cuerpo } = avisoRemitoAnulado(ahora as Parameters<typeof avisoRemitoAnulado>[0], a)
        await enviarPushAUsuarios(destinatarios.docs, { titulo, cuerpo, url: '/admin/comprobantes' }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() })
      } catch (e) {
        console.error(`[anuladas] push a facturación falló: ${(e as Error).message}`)
      }
      // Señal de control (2026-09-12, decisión de Ariel): a partir de la segunda
      // anulación de remito del mismo chofer en el día, aviso al super_admin.
      // No frena nada; es para que lo vea.
      try {
        const cantidad = await anulacionesDeRemitoHoy(db, String(ahora.choferId ?? ''), ahora.fecha as { toDate?: () => Date } | undefined)
        if (cantidad >= 2) {
          const admins = await db.collection('users').where('estado', '==', 'activo').where('rol', '==', 'super_admin').get()
          await enviarPushAUsuarios(admins.docs, {
            titulo: `${String(ahora.choferNombre ?? 'Un chofer')}: ${cantidad} remitos anulados hoy`,
            cuerpo: `El último: ${String(ahora.clienteNombre ?? 'cliente')} · ${a.motivo ?? ''}${a.nota ? ` · ${a.nota}` : ''}. Vale la pena mirarlo en la liquidación.`,
            url: '/caja/liquidaciones',
          }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() })
        }
      } catch (e) {
        console.error(`[anuladas] aviso por cantidad falló: ${(e as Error).message}`)
      }
    }

    try {
      const cierre = await anotarAnulacionPosterior(db, 'ventasCamion', ventaId, ahora)
      if (cierre) console.log(`[anuladas] venta ${ventaId} anotada en la liquidación cerrada ${cierre}`)
    } catch (e) {
      console.error(`[anuladas] no se pudo anotar ${ventaId} en la liquidación: ${(e as Error).message}`)
    }
  },
)

export const onVentaVentanillaAnulada = onDocumentUpdated(
  'ventasVentanilla/{ventaId}',
  async (event) => {
    const antes = event.data?.before.data()?.anulacion as { estado?: string } | undefined
    const ahora = event.data?.after.data()
    const a = ahora?.anulacion as { estado?: string } | undefined
    if (!ahora || !recienAnulada(antes, a)) return
    const ventaId = event.params.ventaId
    try {
      const cierre = await anotarAnulacionPosterior(getFirestore(), 'ventasVentanilla', ventaId, ahora)
      if (cierre) console.log(`[anuladas] venta ${ventaId} anotada en el cierre de caja ${cierre}`)
    } catch (e) {
      console.error(`[anuladas] no se pudo anotar ${ventaId} en el cierre de caja: ${(e as Error).message}`)
    }
  },
)

export const reconciliarRemitosAnulados = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'America/Argentina/Buenos_Aires' },
  async () => {
    const db = getFirestore()
    const pendientes = await db.collection('ventasCamion')
      .where('anulacion.tipo', '==', 'remito')
      .where('anulacion.tango.estado', '==', 'pendiente_oficina')
      .limit(200).get()
    let confirmados = 0
    for (const d of pendientes.docs) {
      const v = d.data()
      const codigo = String(v.clienteCodigoTango ?? '').trim()
      const numero = String((v.tango as { remitoNumero?: string } | undefined)?.remitoNumero ?? '').trim()
      if (!codigo || !numero) continue
      const idx = (await db.doc(`tangoComprobantes/redonhielo_${codigo}`).get()).data()
      const estado = (idx?.remitos as Record<string, { estado?: string }> | undefined)?.[numero]?.estado
      if (estado === 'A') {
        await d.ref.set({ anulacion: { tango: { estado: 'confirmado', en: FieldValue.serverTimestamp() } } }, { merge: true })
        confirmados++
      }
    }
    console.log(`[remitos] anulados pendientes en Tango: ${pendientes.size}, confirmados ahora: ${confirmados}`)
  },
)
