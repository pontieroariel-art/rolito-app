import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { sendEmail, APP_URL, resendApiKey } from '../email'
import { tplPedidoCerca, tplPedidoReprogramado } from '../templates'
import { assertRateLimit } from '../rateLimit'

const STAFF_ROLES = new Set([
  'super_admin', 'gerente_general', 'gerente_comercial',
  'comercial', 'logistica', 'facturacion', 'chofer',
])

async function getRol(uid: string): Promise<string | undefined> {
  const snap = await getFirestore().doc(`users/${uid}`).get()
  return (snap.data()?.rol ?? snap.data()?.role) as string | undefined
}

// El cliente avisa que el camión está cerca (distancia calculada por GPS en el
// navegador). El destinatario y el contenido se derivan del pedido en el
// servidor — el cliente solo pasa el orderId, nunca el email → sin relay.
export const notifyCerca = onCall({ secrets: [resendApiKey] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Requiere autenticación')
  await assertRateLimit(request.auth.uid, 'notifyCerca', 5, 60)

  const orderId = (request.data?.orderId ?? '') as string
  if (!orderId) throw new HttpsError('invalid-argument', 'Falta orderId')

  const db  = getFirestore()
  const ref = db.doc(`orders/${orderId}`)
  const rol = await getRol(request.auth.uid)
  const esStaff = rol ? STAFF_ROLES.has(rol) : false

  // Transacción: lee el pedido y marca el aviso como enviado de forma atómica.
  // Antes no había ningún flag server-side — la única protección contra
  // reenvíos vivía en un useRef del lado del cliente, que se resetea al
  // recargar la página o abrirla en otra pestaña, disparando un segundo email
  // real de producción para el mismo evento.
  const order = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const o = snap.data()
    if (!o) throw new HttpsError('not-found', 'Pedido inexistente')
    if (o.clientId !== request.auth!.uid && !esStaff) {
      throw new HttpsError('permission-denied', 'No autorizado')
    }
    if (o.avisoCercaEnviado) return null
    tx.update(ref, { avisoCercaEnviado: true })
    return o
  })
  if (!order) return { ok: true, skipped: true }

  const email = order.clientEmail as string | undefined
  if (!email) return { ok: true, skipped: true }
  const nombre = ((order.clientName as string) || '').split(' ')[0] || 'Cliente'
  await sendEmail(email, 'Tu pedido está cerca 🚚 - Rolito', tplPedidoCerca(nombre, order.products ?? [], APP_URL))
  return { ok: true }
})

// El staff reprograma un pedido → aviso al cliente. La fecha nueva y el motivo
// ya quedaron persistidos en el pedido por rescheduleOrder antes de esta llamada.
export const notifyReprogramado = onCall({ secrets: [resendApiKey] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Requiere autenticación')

  const rol = await getRol(request.auth.uid)
  if (!rol || !STAFF_ROLES.has(rol)) {
    throw new HttpsError('permission-denied', 'Solo el staff puede reprogramar')
  }
  await assertRateLimit(request.auth.uid, 'notifyReprogramado', 20, 60)

  const orderId = (request.data?.orderId ?? '') as string
  if (!orderId) throw new HttpsError('invalid-argument', 'Falta orderId')

  const snap = await getFirestore().doc(`orders/${orderId}`).get()
  const o = snap.data()
  if (!o) throw new HttpsError('not-found', 'Pedido inexistente')

  const email = o.clientEmail as string | undefined
  if (!email) return { ok: true, skipped: true }
  const nombre = ((o.clientName as string) || '').split(' ')[0] || 'Cliente'
  const motivo = (o.motivoReprogramacion as string) || 'Sin especificar'
  await sendEmail(
    email,
    'Tu pedido fue reprogramado 📅 - Rolito',
    tplPedidoReprogramado(nombre, o.products ?? [], o.date, motivo),
  )
  return { ok: true }
})
