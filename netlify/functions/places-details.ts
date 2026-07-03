import type { Handler } from '@netlify/functions'

const CORS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN ?? 'https://app.rolito.com.ar',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'API key not configured' }) }

  try {
    const { placeId } = JSON.parse(event.body ?? '{}') as { placeId?: string }
    if (!placeId?.trim()) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing placeId' }) }

    const res  = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=formattedAddress,location&key=${apiKey}`,
    )

    const data = await res.json()
    if (!res.ok) {
      console.error('Places details error:', data)
      return { statusCode: res.status, headers: CORS, body: JSON.stringify({ error: data.error?.message ?? 'Places API error' }) }
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify(data) }
  } catch (err) {
    console.error('places-details error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Internal error' }) }
  }
}
