/**
 * Remito de cuenta corriente anulado por el chofer (2026-09-11, decisión de
 * Ariel: sin autorización, para ser ágil en la calle). Camino A: la app saca
 * la venta de la liquidación y del stock del camión; el remito en Tango lo
 * anula la oficina a mano, como hasta hoy.
 *
 *   - onRemitoAnuladoPorChofer: al aparecer `anulacion.tipo = 'remito'` en la
 *     venta, marca `anulacion.tango = pendiente_oficina` y avisa por push a
 *     facturación (y al super_admin) con el número de remito a anular.
 *   - reconciliarRemitosAnulados (cada hora): mira el índice de comprobantes
 *     de Tango que publica el lector de la VM (tangoComprobantes) y, cuando el
 *     remito figura con ESTADO_MOV 'A', deja `anulacion.tango = confirmado`.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { enviarPushAUsuarios } from '../services/push'

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

interface AnulacionRemito { tipo?: string; estado?: string; motivo?: string; nota?: string; anuladaPor?: { nombre?: string }; tango?: { estado?: string } }

/** Texto de la push a facturación. Pura. */
export function avisoRemitoAnulado(venta: { clienteNombre?: unknown; choferNombre?: unknown; tango?: { remitoNumero?: unknown } | null; comprobanteInterno?: { puntoVenta?: number; numero?: number } | null }, a: AnulacionRemito): { titulo: string; cuerpo: string } {
  const ci = venta.comprobanteInterno
  const numero = String(venta.tango?.remitoNumero ?? (ci ? `${String(ci.puntoVenta ?? 0).padStart(5, '0')}-${String(ci.numero ?? 0).padStart(8, '0')}` : 'sin número'))
  return {
    titulo: 'Remito anulado por el chofer: anularlo en Tango',
    cuerpo: `${String(venta.choferNombre ?? 'Chofer')} anuló el remito ${numero} de ${String(venta.clienteNombre ?? 'cliente')} · ${a.motivo ?? ''}${a.nota ? ` · ${a.nota}` : ''}. Hay que anularlo en Tango.`,
  }
}

export const onRemitoAnuladoPorChofer = onDocumentUpdated(
  { document: 'ventasCamion/{ventaId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const antes = event.data?.before.data()?.anulacion as AnulacionRemito | undefined
    const ahora = event.data?.after.data()
    const a = ahora?.anulacion as AnulacionRemito | undefined
    if (!ahora || !a || a.tipo !== 'remito' || a.estado !== 'anulada') return
    if (antes?.tipo === 'remito' && antes.estado === 'anulada') return   // ya procesada
    const db = getFirestore()
    await event.data!.after.ref.set({ anulacion: { tango: { estado: 'pendiente_oficina' } } }, { merge: true })
    try {
      const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get()
      const { titulo, cuerpo } = avisoRemitoAnulado(ahora as Parameters<typeof avisoRemitoAnulado>[0], a)
      await enviarPushAUsuarios(destinatarios.docs, { titulo, cuerpo, url: '/admin/comprobantes' }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() })
    } catch (e) {
      console.error(`[remitos] push a facturación falló: ${(e as Error).message}`)
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
    console.log(`[remitos] anulados por chofer pendientes en Tango: ${pendientes.size}, confirmados ahora: ${confirmados}`)
  },
)
