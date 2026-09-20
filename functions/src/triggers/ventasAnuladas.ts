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
import { confirmarRemitosAnulados } from '../services/anuladosEnTango'

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

/**
 * Encola la anulación del remito para que el bridge la ejecute en Tango
 * (2026-09-20). Devuelve false —y el circuito sigue con la oficina a mano—
 * cuando el interruptor está apagado o cuando no hay nada que anular allá.
 *
 * El interruptor vive en `config/tango.anulacionRemitoSqlEnabled`, igual que
 * los demás writers, y arranca apagado: se prende después del dry-run contra
 * Tango real.
 */
async function encolarAnulacionRemito(
  db: FirebaseFirestore.Firestore,
  ventaId: string,
  venta: Record<string, unknown>,
): Promise<boolean> {
  const remitoNumero = String((venta.tango as { remitoNumero?: unknown } | undefined)?.remitoNumero ?? '').trim()
  // Sin número, el remito nunca llegó a Tango: no hay nada que anular y la
  // oficina tampoco tiene qué buscar.
  if (!remitoNumero) return false

  const cfg = (await db.doc('config/tango').get()).data() ?? {}
  if (cfg.anulacionRemitoSqlEnabled !== true) return false

  const outboxId = `anulacionRemito_${ventaId}`
  try {
    await db.collection('tango-outbox').doc(outboxId).create({
      entidad:         'anulacionRemito',
      origenColeccion: 'ventasCamion',
      origenId:        ventaId,
      empresa:         'redonhielo',   // el remito R del camión es de Redonhielo
      payload:         { remitoNumero },
      estado:          'pendiente',
      intentos:        0,
      ultimoError:     null,
      creadoEn:        FieldValue.serverTimestamp(),
      actualizadoEn:   FieldValue.serverTimestamp(),
    })
    return true
  } catch (err) {
    // 6 = ALREADY_EXISTS: la anulación ya estaba encolada (reintento del trigger).
    if ((err as { code?: number })?.code === 6) return true
    console.error(`[anuladas] no se pudo encolar la anulación de ${ventaId}: ${(err as Error).message}`)
    return false
  }
}

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
      // Que la app lo anule sola en Tango (2026-09-20). Hasta hoy lo hacía la
      // oficina a mano y tardaba días: en esa ventana Tango llegaba a FACTURAR
      // la mercadería (3 de 7 casos) y ahí el remito ya no se puede anular.
      // Mientras el interruptor esté apagado, o si el remito nunca llegó a
      // Tango, sigue el camino de siempre: pendiente_oficina y push.
      const encolado = await encolarAnulacionRemito(db, ventaId, ahora)
      await event.data!.after.ref.set(
        { anulacion: { tango: { estado: encolado ? 'encolado' : 'pendiente_oficina' } } },
        { merge: true },
      )
      // El pedido a facturación solo tiene sentido si lo va a hacer a mano. Con
      // la anulación encolada, despertar a alguien para un trabajo que ya está
      // hecho es la clase de aviso que enseña a ignorar los avisos.
      if (!encolado) {
        try {
          const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get()
          const { titulo, cuerpo } = avisoRemitoAnulado(ahora as Parameters<typeof avisoRemitoAnulado>[0], a)
          await enviarPushAUsuarios(destinatarios.docs, { titulo, cuerpo, url: '/admin/comprobantes' }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() })
        } catch (e) {
          console.error(`[anuladas] push a facturación falló: ${(e as Error).message}`)
        }
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
    const { pendientes, confirmados } = await confirmarRemitosAnulados(getFirestore())
    console.log(`[remitos] anulados pendientes en Tango: ${pendientes}, confirmados ahora: ${confirmados}`)
  },
)
