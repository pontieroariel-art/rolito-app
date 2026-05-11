import type { Handler } from '@netlify/functions'
import { sendEmail } from './_shared/email'
import { tplRegistroPendiente } from './_shared/templates'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' }

  try {
    const { email, nombre } = JSON.parse(event.body ?? '{}') as {
      email?: string
      nombre?: string
    }

    if (!email) return { statusCode: 400, headers: CORS, body: 'Missing email' }

    await sendEmail(
      email,
      'Tu cuenta en Rolito está siendo verificada',
      tplRegistroPendiente(nombre ?? 'Cliente'),
    )

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) }
  } catch (err) {
    console.error('notify-registro error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Internal error' }) }
  }
}
