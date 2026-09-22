/**
 * Aviso cuando el COT de un remito de carga queda en error (2026-09-22).
 *
 * Entre el 21 y el 22/09 rebotaron 11 de 11 COT a clientes y nadie se enteró:
 * el error quedaba en `remitosCarga.cot.error` y el tile del panel de control
 * lo contaba, pero nadie lo miró. Un camión que sale sin COT es una multa en la
 * ruta. Cada vez que `cot.estado` pasa a 'error' (primera vez o error nuevo)
 * se avisa por push a caja, logística y super_admin con el remito y el motivo;
 * la pantalla de remitos tiene el botón para reintentar.
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { enviarPushAUsuarios } from '../services/push'

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

/** ¿Hay que avisar? Solo cuando el error aparece o cambia (no en cada reintento con el mismo mensaje). Pura. */
export function cotPasoAError(antes: { cot?: { estado?: unknown; error?: unknown } } | undefined, ahora: { cot?: { estado?: unknown; error?: unknown } } | undefined): boolean {
  if (ahora?.cot?.estado !== 'error') return false
  if (antes?.cot?.estado !== 'error') return true
  return String(antes.cot.error ?? '') !== String(ahora.cot.error ?? '')
}

export function avisoCotError(r: { codigo?: unknown; choferNombre?: unknown; camionLabel?: unknown; kg?: unknown; cot?: { error?: unknown } }): { titulo: string; cuerpo: string } {
  const kg = typeof r.kg === 'number' ? ` · ${r.kg.toLocaleString('es-AR')} kg` : ''
  return {
    titulo: `COT rechazado: ${String(r.codigo ?? 'remito')}`,
    cuerpo: `${String(r.choferNombre ?? '')} · ${String(r.camionLabel ?? '')}${kg}. ARBA respondió: ${String(r.cot?.error ?? 'error').slice(0, 160)} Reintentá desde Remitos de carga.`,
  }
}

export const onCotError = onDocumentUpdated(
  { document: 'remitosCarga/{remitoId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const antes = event.data?.before.data()
    const ahora = event.data?.after.data()
    if (!cotPasoAError(antes as never, ahora as never)) return
    const db = getFirestore()
    console.error(`[cot] ${String(ahora?.codigo ?? event.params.remitoId)} en error: ${String(ahora?.cot?.error ?? '')}`)
    try {
      const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['caja', 'logistica', 'super_admin']).get()
      await enviarPushAUsuarios(
        destinatarios.docs,
        { ...avisoCotError(ahora as never), url: '/caja/remitos' },
        { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() },
      )
    } catch (e) {
      console.error(`[cot] push del error falló: ${(e as Error).message}`)
    }
  },
)
