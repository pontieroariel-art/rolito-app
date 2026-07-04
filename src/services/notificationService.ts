import { getFunctions, httpsCallable } from 'firebase/functions'

// Todas las notificaciones corren en Cloud Functions del mismo proyecto:
// - Emails de registro/aprobación/pedido creado/confirmado/en-camino → triggers
//   de Firestore (functions/src/triggers/orders|users).
// - web-push, "pedido cerca" y "reprogramado" → callables (abajo).
// Ya no se dispara nada contra la capa de Netlify Functions.

export const sendPush = async (data: {
  subscription: PushSubscriptionJSON
  title:        string
  body:         string
}): Promise<void> => {
  try {
    await httpsCallable(getFunctions(), 'sendPush')(data)
  } catch (err) {
    console.error('sendPush error:', err)
  }
}

// El destinatario y el contenido se derivan del pedido en el servidor; el
// cliente solo pasa el orderId.
export const notifyCerca = async (data: { orderId: string }): Promise<void> => {
  try {
    await httpsCallable(getFunctions(), 'notifyCerca')(data)
  } catch (err) {
    console.error('notifyCerca error:', err)
  }
}

export const notifyReprogramado = async (data: { orderId: string }): Promise<void> => {
  try {
    await httpsCallable(getFunctions(), 'notifyReprogramado')(data)
  } catch (err) {
    console.error('notifyReprogramado error:', err)
  }
}
