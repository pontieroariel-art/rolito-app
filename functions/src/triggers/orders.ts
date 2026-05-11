import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { getFirestore } from 'firebase-admin/firestore'
import { sendEmail, APP_URL } from '../email'
import {
  tplPedidoRecibido,
  tplPedidoEnCamino,
  tplAdminNuevoPedido,
} from '../templates'

// Dispara cuando se crea un pedido en orders/{orderId}
// Envía confirmación al cliente y notificación a los emails admin configurados
export const onOrderCreated = onDocumentCreated('orders/{orderId}', async (event) => {
  const order = event.data?.data()
  if (!order) return

  const db            = getFirestore()
  const clientEmail   = order.clientEmail as string | undefined
  const clientName    = (order.clientName  || '') as string
  const products      = (order.products    || []) as Array<{ name: string; quantity: number }>
  const date          = order.date
  const notes         = (order.notes || '') as string

  // — Notificación al cliente ------------------------------------------------
  // Si el pedido incluye el email del cliente, enviamos directamente.
  // Si no (pedidos viejos), lo buscamos en Firestore por clientId.
  let emailToClient = clientEmail
  if (!emailToClient && order.clientId) {
    try {
      const userSnap = await db.doc(`users/${order.clientId}`).get()
      emailToClient  = userSnap.data()?.email as string | undefined
    } catch {
      // silencioso — no bloqueamos el trigger si falla el lookup
    }
  }

  const nombre = clientName.split(' ')[0] || 'Cliente'

  if (emailToClient) {
    await sendEmail(
      emailToClient,
      'Pedido recibido - Rolito',
      tplPedidoRecibido(nombre, products, date, notes),
    )
  }

  // — Notificación a administración -----------------------------------------
  let adminEmails: string[] = []
  try {
    const notifSnap = await db.doc('configuracion/notificaciones').get()
    adminEmails     = (notifSnap.data()?.emails as string[]) ?? []
  } catch {
    // sin config → no notificamos
  }

  if (adminEmails.length > 0) {
    await sendEmail(
      adminEmails,
      `Nuevo pedido de ${clientName}`,
      tplAdminNuevoPedido({
        clientName,
        clientAddress: (order.clientAddress || '') as string,
        clientPhone:   (order.clientPhone   || '') as string,
        products,
        date,
        notes,
      }),
    )
  }
})

// Dispara cuando se actualiza un pedido en orders/{orderId}
// Solo actúa cuando el status cambia a 'en_camino'
export const onOrderEnCamino = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before = event.data?.before.data()
  const after  = event.data?.after.data()
  if (!before || !after) return
  if (before.status === 'en_camino' || after.status !== 'en_camino') return

  const db          = getFirestore()
  const clientName  = (after.clientName || '') as string
  const products    = (after.products   || []) as Array<{ name: string; quantity: number }>
  const nombre      = clientName.split(' ')[0] || 'Cliente'

  // Obtenemos el email del cliente
  let emailToClient = after.clientEmail as string | undefined
  if (!emailToClient && after.clientId) {
    try {
      const userSnap = await db.doc(`users/${after.clientId}`).get()
      emailToClient  = userSnap.data()?.email as string | undefined
    } catch {
      // silencioso
    }
  }

  if (!emailToClient) return

  await sendEmail(
    emailToClient,
    'Tu pedido está en camino 🚛',
    tplPedidoEnCamino(nombre, products, APP_URL),
  )
})
