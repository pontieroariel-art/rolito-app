import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'

const orsKey = defineSecret('ORS_KEY')

interface AvoidPolygons {
  type:        string
  coordinates: number[][][][]
}

interface OrsDirectionsData {
  coordinates?:   number[][]
  avoidPolygons?: AvoidPolygons | null
}

// Proxy server-side de ORS Directions. La API key de OpenRouteService vive como
// secreto de Functions (ORS_KEY) y NUNCA se manda al navegador — antes viajaba
// en el bundle como VITE_ORS_KEY, extraíble por cualquiera para gastar la cuota.
// Solo el staff planifica rutas; el cliente no llama esto. Ante cualquier fallo
// de ORS se lanza HttpsError para que el cliente use su fallback local.
export const orsDirections = onCall({ secrets: [orsKey] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Requiere autenticación')

  const snap = await getFirestore().doc(`users/${request.auth.uid}`).get()
  const rol  = (snap.data()?.rol ?? snap.data()?.role) as string | undefined
  if (!rol || rol === 'cliente') {
    throw new HttpsError('permission-denied', 'Solo el staff puede calcular rutas')
  }

  const { coordinates, avoidPolygons } = (request.data ?? {}) as OrsDirectionsData
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new HttpsError('invalid-argument', 'Se requieren al menos 2 coordenadas')
  }

  const body: Record<string, unknown> = { coordinates }
  if (avoidPolygons && Array.isArray(avoidPolygons.coordinates) && avoidPolygons.coordinates.length > 0) {
    body.options = { avoid_polygons: avoidPolygons }
  }

  let data: { features?: Array<{ geometry?: { coordinates?: unknown }; properties?: { segments?: unknown } }>; error?: { message?: string } }
  try {
    const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-hgv/geojson', {
      method:  'POST',
      headers: { Authorization: orsKey.value(), 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    data = await res.json()
  } catch (err) {
    throw new HttpsError('unavailable', `ORS inaccesible: ${err instanceof Error ? err.message : 'error'}`)
  }

  const feature  = data.features?.[0]
  const segments = feature?.properties?.segments
  if (!feature?.geometry?.coordinates || !segments) {
    throw new HttpsError('unavailable', data.error?.message ?? 'Sin ruta de ORS')
  }

  return { geometry: { coordinates: feature.geometry.coordinates }, segments }
})
