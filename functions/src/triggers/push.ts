import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import webpush from 'web-push'

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

interface SendPushData {
  subscription?: webpush.PushSubscription
  title?:        string
  body?:         string
}

// Envío de web-push desde el servidor. Reemplaza la Netlify Function `send-push`,
// que quedó inalcanzable al hostear la app en Firebase Hosting (las llamadas
// relativas a /.netlify/functions caían en el rewrite SPA). Al ser una callable
// del mismo proyecto: sin CORS, con auth automática, y solo el staff puede
// disparar notificaciones (cierra el relay abierto que tenía la función vieja).
export const sendPush = onCall(
  { secrets: [vapidPublicKey, vapidPrivateKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Requiere autenticación')
    }

    // Solo el staff envía notificaciones (nunca un cliente)
    const snap = await getFirestore().doc(`users/${request.auth.uid}`).get()
    const rol  = (snap.data()?.rol ?? snap.data()?.role) as string | undefined
    if (!rol || rol === 'cliente') {
      throw new HttpsError('permission-denied', 'Solo el staff puede enviar notificaciones')
    }

    const { subscription, title, body } = (request.data ?? {}) as SendPushData
    if (!subscription?.endpoint || !title) {
      throw new HttpsError('invalid-argument', 'Faltan subscription o title')
    }

    webpush.setVapidDetails(
      'mailto:pedidos@rolito.com.ar',
      vapidPublicKey.value(),
      vapidPrivateKey.value(),
    )

    try {
      await webpush.sendNotification(subscription, JSON.stringify({ title, body: body ?? '' }))
    } catch (err) {
      // Una suscripción vencida o inválida no debe romper el flujo del que llama.
      console.error('sendPush error:', err)
    }

    return { ok: true }
  },
)
