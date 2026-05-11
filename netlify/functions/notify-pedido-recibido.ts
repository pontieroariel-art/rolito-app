import type { Handler } from '@netlify/functions'
import { sendEmail } from './_shared/email'
import { tplPedidoRecibido, Product } from './_shared/templates'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' }

  try {
    const { email, nombre, products, date, notes } = JSON.parse(event.body ?? '{}') as {
      email?:    string
      nombre?:   string
      products?: Product[]
      date?:     string
      notes?:    string
    }

    if (!email) return { statusCode: 400, headers: CORS, body: 'Missing email' }

    await sendEmail(
      email,
      'Pedido recibido - Rolito',
      tplPedidoRecibido(nombre ?? 'Cliente', products ?? [], date, notes),
    )

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) }
  } catch (err) {
    console.error('notify-pedido-recibido error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Internal error' }) }
  }
}
