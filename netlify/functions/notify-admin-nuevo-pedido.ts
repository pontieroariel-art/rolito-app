import type { Handler } from '@netlify/functions'
import { sendEmail } from './_shared/email'
import { tplAdminNuevoPedido, Product } from './_shared/templates'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' }

  try {
    const {
      adminEmails,
      clientName,
      clientAddress,
      clientPhone,
      products,
      date,
      notes,
    } = JSON.parse(event.body ?? '{}') as {
      adminEmails?:   string[]
      clientName?:    string
      clientAddress?: string
      clientPhone?:   string
      products?:      Product[]
      date?:          string
      notes?:         string
    }

    if (!adminEmails?.length) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, skipped: true }) }
    }

    await sendEmail(
      adminEmails,
      `Nuevo pedido de ${clientName ?? 'cliente'}`,
      tplAdminNuevoPedido({
        clientName:    clientName    ?? '',
        clientAddress: clientAddress ?? '',
        clientPhone:   clientPhone   ?? '',
        products:      products      ?? [],
        date,
        notes,
      }),
    )

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) }
  } catch (err) {
    console.error('notify-admin-nuevo-pedido error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Internal error' }) }
  }
}
