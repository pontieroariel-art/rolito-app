import type { Handler } from '@netlify/functions'
import webpush from 'web-push'

const CORS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN ?? 'https://app.rolito.com.ar',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

webpush.setVapidDetails(
  'mailto:pedidos@rolito.com.ar',
  process.env.VAPID_PUBLIC_KEY  ?? '',
  process.env.VAPID_PRIVATE_KEY ?? '',
)

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' }

  try {
    const { subscription, title, body } = JSON.parse(event.body ?? '{}') as {
      subscription?: PushSubscriptionJSON
      title?:        string
      body?:         string
    }

    if (!subscription?.endpoint) return { statusCode: 400, headers: CORS, body: 'Missing subscription' }
    if (!title)                   return { statusCode: 400, headers: CORS, body: 'Missing title' }

    await webpush.sendNotification(
      subscription as webpush.PushSubscription,
      JSON.stringify({ title, body: body ?? '' }),
    )

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) }
  } catch (err) {
    console.error('send-push error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Internal error' }) }
  }
}
