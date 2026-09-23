import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { getFirestore } from 'firebase-admin/firestore'
import { sendEmail, destinatariosAviso, APP_URL, MAIL_SECRETS } from '../email'
import {
  tplPedidoRecibido, tplPedidoConfirmado, tplPedidoEnCamino, tplAdminNuevoPedido,
} from '../templates'

async function getClientEmail(order: Record<string, unknown>): Promise<string | undefined> {
  if (order.clientEmail) return order.clientEmail as string
  if (order.clientId) {
    try {
      const snap = await getFirestore().doc(`users/${order.clientId}`).get()
      return snap.data()?.email as string | undefined
    } catch { /* silencioso */ }
  }
  return undefined
}

// Nuevo pedido → email al cliente + email al admin
export const onOrderCreated = onDocumentCreated({ document: 'orders/{orderId}', secrets: MAIL_SECRETS }, async (event) => {
  const order = event.data?.data() as Record<string, unknown> | undefined
  if (!order) return

  // Entrega con remito de fábrica (Coto/Carrefour, 2026-09-23): si el cliente
  // tiene la marca, el pedido nace sellado y el chofer lo entrega sin
  // comprobante de la app. Se sella acá y no en el front para que valga igual
  // lo cargue quien lo cargue (logística, el cliente, un recurrente).
  const clientId = order.clientId as string | undefined
  if (clientId && clientId !== 'externo' && order.entregaSinComprobante !== true) {
    try {
      const cliente = (await getFirestore().doc(`users/${clientId}`).get()).data()
      if (cliente?.entregaConRemitoDeFabrica === true) await event.data!.ref.update({ entregaSinComprobante: true })
    } catch (e) {
      console.error(`[onOrderCreated] no se pudo sellar entregaSinComprobante en ${event.params.orderId}: ${(e as Error).message}`)
    }
  }

  const clientName = (order.clientName || '') as string
  const products   = (order.products || []) as { name: string; quantity: number }[]
  const nombre     = clientName.split(' ')[0] || 'Cliente'

  // Email al cliente
  const emailCliente = await getClientEmail(order)
  if (emailCliente) {
    await sendEmail(
      emailCliente,
      'Pedido recibido - Rolito',
      tplPedidoRecibido(nombre, products, order.date, order.notes as string | undefined),
    )
  }

  // Aviso interno a la oficina (lista "Nuevo pedido" de Ajustes generales).
  const adminEmails = await destinatariosAviso('nuevoPedido')

  if (adminEmails.length > 0) {
    await sendEmail(
      adminEmails,
      `Nuevo pedido de ${clientName}`,
      tplAdminNuevoPedido({
        clientName,
        clientAddress: (order.clientAddress || '') as string,
        clientPhone:   (order.clientPhone   || '') as string,
        products,
        date:          order.date,
        notes:         order.notes as string | undefined,
      }),
    )
  }
})

// Pedido confirmado → email al cliente
export const onOrderConfirmado = onDocumentUpdated({ document: 'orders/{orderId}', secrets: MAIL_SECRETS }, async (event) => {
  const before = event.data?.before.data() as Record<string, unknown> | undefined
  const after  = event.data?.after.data()  as Record<string, unknown> | undefined
  if (!before || !after) return
  if (before.status === 'confirmado' || after.status !== 'confirmado') return

  const clientName = (after.clientName || '') as string
  const products   = (after.products || []) as { name: string; quantity: number }[]
  const nombre     = clientName.split(' ')[0] || 'Cliente'

  const emailCliente = await getClientEmail(after)
  if (!emailCliente) return

  await sendEmail(
    emailCliente,
    'Tu pedido fue confirmado ✅ - Rolito',
    tplPedidoConfirmado(nombre, products, after.date),
  )
})

// Pedido en camino → email al cliente
export const onOrderEnCamino = onDocumentUpdated({ document: 'orders/{orderId}', secrets: MAIL_SECRETS }, async (event) => {
  const before = event.data?.before.data() as Record<string, unknown> | undefined
  const after  = event.data?.after.data()  as Record<string, unknown> | undefined
  if (!before || !after) return
  if (before.status === 'en_camino' || after.status !== 'en_camino') return

  const clientName = (after.clientName || '') as string
  const products   = (after.products || []) as { name: string; quantity: number }[]
  const nombre     = clientName.split(' ')[0] || 'Cliente'

  const emailCliente = await getClientEmail(after)
  if (!emailCliente) return

  await sendEmail(
    emailCliente,
    'Tu pedido está en camino 🚛 - Rolito',
    tplPedidoEnCamino(nombre, products, APP_URL),
  )
})
