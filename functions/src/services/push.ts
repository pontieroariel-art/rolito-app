/**
 * Push a un conjunto de usuarios (docs de `users` con `pushSubscription`).
 *
 * Mismo patrón que `triggers/supervisor.ts` y `triggers/heladeras.ts` (que
 * siguen con su copia local para no redeployarlos): filtra los que tienen
 * suscripción, manda, y limpia las suscripciones muertas (404/410). Acepta una
 * `url` para que el service worker abra la pantalla que corresponde al tocar
 * la notificación.
 */

import { FieldValue } from 'firebase-admin/firestore'
import webpush from 'web-push'

export interface ClavesVapid {
  vapidPublicKey: string
  vapidPrivateKey: string
}

interface DocUsuario {
  data(): Record<string, unknown> | undefined
  ref: { update(d: Record<string, unknown>): Promise<unknown> }
}

function isStaleSubscriptionError(err: unknown): boolean {
  const status = (err as { statusCode?: number })?.statusCode
  return status === 404 || status === 410
}

export async function enviarPushAUsuarios(
  docs: DocUsuario[],
  aviso: { titulo: string; cuerpo: string; url?: string },
  claves: ClavesVapid,
): Promise<{ enviados: number }> {
  const conSubscripcion = docs.filter((d) => (d.data()?.pushSubscription as { endpoint?: string } | undefined)?.endpoint)
  if (conSubscripcion.length === 0) return { enviados: 0 }
  webpush.setVapidDetails('mailto:pedidos@rolito.com.ar', claves.vapidPublicKey, claves.vapidPrivateKey)
  const payload = JSON.stringify({ title: aviso.titulo, body: aviso.cuerpo, ...(aviso.url ? { url: aviso.url } : {}) })
  let enviados = 0
  await Promise.all(conSubscripcion.map(async (d) => {
    try {
      await webpush.sendNotification(d.data()?.pushSubscription as never, payload)
      enviados++
    } catch (err) {
      if (isStaleSubscriptionError(err)) await d.ref.update({ pushSubscription: FieldValue.delete() }).catch(() => {})
    }
  }))
  return { enviados }
}
