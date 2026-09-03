import { getFunctions, httpsCallable } from 'firebase/functions'
import { reportError } from './observability'

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
    reportError(err, { callable: 'sendPush' })
  }
}

// El destinatario y el contenido se derivan del pedido en el servidor; el
// cliente solo pasa el orderId.
export const notifyCerca = async (data: { orderId: string }): Promise<void> => {
  try {
    await httpsCallable(getFunctions(), 'notifyCerca')(data)
  } catch (err) {
    reportError(err, { callable: 'notifyCerca', orderId: data.orderId })
  }
}

export const notifyReprogramado = async (data: { orderId: string }): Promise<void> => {
  try {
    await httpsCallable(getFunctions(), 'notifyReprogramado')(data)
  } catch (err) {
    reportError(err, { callable: 'notifyReprogramado', orderId: data.orderId })
  }
}
