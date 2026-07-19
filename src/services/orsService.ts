import { getFunctions, httpsCallable } from 'firebase/functions'

export interface OrsSegment { duration: number }

export interface OrsDirectionsResult {
  geometry: { coordinates: [number, number][] }
  segments: OrsSegment[]
}

export interface OrsAvoidPolygons {
  type:        'MultiPolygon'
  coordinates: number[][][][]
}

// Llama a la Cloud Function `orsDirections`, que consulta ORS server-side con la
// key secreta (ya no viaja en el bundle). Devuelve la geometría del camino y la
// duración de cada tramo. Si ORS falla, la function lanza error y este promise
// rechaza — cada caller tiene su propio fallback (estimación local / Google).
export async function fetchOrsDirections(
  coordinates:    number[][],
  avoidPolygons?: OrsAvoidPolygons | null,
): Promise<OrsDirectionsResult> {
  const call = httpsCallable<
    { coordinates: number[][]; avoidPolygons?: OrsAvoidPolygons | null },
    OrsDirectionsResult
  >(getFunctions(), 'orsDirections')
  const res = await call({ coordinates, avoidPolygons: avoidPolygons ?? null })
  return res.data
}
