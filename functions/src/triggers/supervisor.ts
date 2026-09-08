import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import webpush from 'web-push'

// Avisos a logística por lo que el supervisor toma en la calle (2026-09-07):
// un pedido (entra a la Bandeja sin día) o una visita (sin chofer). Server-
// side porque el supervisor no puede leer el directorio de staff (reglas de
// `users`) ni disparar push a otros. Solo avisa cuando el doc trae
// `origenSupervisor`; el resto de pedidos/visitas los crea logística misma.

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

function isStaleSubscriptionError(err: unknown): boolean {
  const status = (err as { statusCode?: number })?.statusCode
  return status === 404 || status === 410
}

async function avisarLogistica(titulo: string, cuerpo: string): Promise<void> {
  const db = getFirestore()
  const [logistica, admins] = await Promise.all([
    db.collection('users').where('rol', '==', 'logistica').where('estado', '==', 'activo').get(),
    db.collection('users').where('rol', '==', 'super_admin').where('estado', '==', 'activo').get(),
  ])
  const conSubscripcion = [...logistica.docs, ...admins.docs].filter((d) => d.data().pushSubscription?.endpoint)
  if (conSubscripcion.length === 0) return
  webpush.setVapidDetails('mailto:pedidos@rolito.com.ar', vapidPublicKey.value(), vapidPrivateKey.value())
  await Promise.all(conSubscripcion.map(async (d) => {
    try {
      await webpush.sendNotification(d.data().pushSubscription, JSON.stringify({ title: titulo, body: cuerpo }))
    } catch (err) {
      if (isStaleSubscriptionError(err)) await d.ref.update({ pushSubscription: FieldValue.delete() }).catch(() => {})
    }
  }))
}

const nombreDe = (o: Record<string, unknown>) => ((o.origenSupervisor as { nombre?: string } | undefined)?.nombre ?? 'un supervisor')

export const onPedidoSupervisorCreado = onDocumentCreated(
  { document: 'orders/{orderId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const o = event.data?.data() as Record<string, unknown> | undefined
    if (!o?.origenSupervisor) return
    const productos = ((o.products ?? []) as Array<{ name?: string; quantity?: number }>)
      .map((p) => `${p.quantity ?? ''} ${p.name ?? ''}`.trim()).join(', ')
    await avisarLogistica('Pedido a programar', `${(o.clientName ?? '') as string} — ${productos || 'sin productos'} (lo tomó ${nombreDe(o)})`)
  },
)

export const onVisitaSupervisorCreada = onDocumentCreated(
  { document: 'visitas-puntuales/{visitaId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const v = event.data?.data() as Record<string, unknown> | undefined
    if (!v?.origenSupervisor) return
    await avisarLogistica('Visita a asignar', `${(v.clientName ?? '') as string}${v.notas ? `: ${v.notas as string}` : ''} (la pidió ${nombreDe(v)})`)
  },
)
