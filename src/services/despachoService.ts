import {
  collection, doc, setDoc, onSnapshot,
  query, where, Timestamp,
} from 'firebase/firestore'

import { db } from './firebase'
import { Despacho } from '../types'

export const despachoId = (fecha: string, driverId: string) =>
  `${fecha}_${driverId.replace(/[^a-zA-Z0-9]/g, '_')}`

export const saveDespacho = (d: Despacho): Promise<void> =>
  setDoc(doc(db, 'despachos', d.id), d, { merge: true })

export const subscribeDespachosByFecha = (
  fecha: string,
  cb: (despachos: Despacho[]) => void,
): () => void => {
  const q = query(collection(db, 'despachos'), where('fecha', '==', fecha))
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ ...d.data(), id: d.id } as Despacho)))
  })
}

export const subscribeMyDespacho = (
  fecha: string,
  driverEmail: string,
  cb: (d: Despacho | null) => void,
): () => void => {
  const id = despachoId(fecha, driverEmail)
  return onSnapshot(doc(db, 'despachos', id), (snap) => {
    cb(snap.exists() ? ({ ...snap.data(), id: snap.id } as Despacho) : null)
  })
}

export const subscribeDespachoForAyudante = (
  fecha: string,
  ayudanteEmail: string,
  cb: (d: Despacho | null) => void,
): () => void => {
  const q = query(
    collection(db, 'despachos'),
    where('fecha', '==', fecha),
    where('ayudanteEmail', '==', ayudanteEmail),
  )
  return onSnapshot(q, (snap) => {
    if (snap.empty) { cb(null); return }
    const d = snap.docs[0]
    cb({ ...d.data(), id: d.id } as Despacho)
  })
}

// ── Nearest-neighbor local (siempre disponible, sin API) ─────────────────────

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R    = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function nearestNeighborOrder(
  stopIds: string[],
  coords: Record<string, { lat: number; lng: number }>,
  origin: { lat: number; lng: number },
): string[] {
  const remaining = stopIds.filter((id) => coords[id])
  const noCoord   = stopIds.filter((id) => !coords[id])
  const ordered: string[] = []
  let current = origin
  while (remaining.length > 0) {
    let bestIdx  = 0
    let bestDist = Infinity
    remaining.forEach((id, i) => {
      const d = haversineKm(current, coords[id])
      if (d < bestDist) { bestDist = d; bestIdx = i }
    })
    const [next] = remaining.splice(bestIdx, 1)
    ordered.push(next)
    current = coords[next]
  }
  return [...ordered, ...noCoord]
}

// ── Estimación de horarios de llegada (local) ─────────────────────────────────

function estimateArrivals(
  orderedIds: string[],
  coords:     Record<string, { lat: number; lng: number }>,
  origin:     { lat: number; lng: number },
  departureUnix: number,
): Record<string, string> {
  const AVG_SPEED_KMH = 30
  const SERVICE_MIN   = 5
  let t = departureUnix
  let pos = origin
  const out: Record<string, string> = {}
  for (const id of orderedIds) {
    if (!coords[id]) continue
    const dist = haversineKm(pos, coords[id])
    t   += (dist / AVG_SPEED_KMH) * 3600 + SERVICE_MIN * 60
    pos  = coords[id]
    const d = new Date(t * 1000)
    out[id] = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  return out
}

// ── ORS Optimization + fallback a nearest-neighbor ───────────────────────────

export async function optimizeStopOrder(params: {
  stopIds:     string[]
  coords:      Record<string, { lat: number; lng: number }>
  arrivals?:   Record<string, string>
  closeTimes?: Record<string, string>
  fecha:       string
  departure:   string
  planta:      { lat: number; lng: number }
  orsKey:      string
}): Promise<{ orderedIds: string[]; arrivals: Record<string, string>; orsOk: boolean; orsError?: string }> {
  const { stopIds, coords, fecha, departure, planta, orsKey } = params

  const validIds = stopIds.filter((id) => coords[id])

  function timeStrToUnix(dateStr: string, time: string): number {
    const [h, m] = time.split(':').map(Number)
    const d = new Date(dateStr + 'T00:00:00')
    d.setHours(h, m, 0, 0)
    return Math.floor(d.getTime() / 1000)
  }
  function unixToTimeStr(unix: number): string {
    const d = new Date(unix * 1000)
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const vehicleStart = timeStrToUnix(fecha, departure)
  const vehicleEnd   = timeStrToUnix(fecha, '22:00')

  // ── Intentar ORS ──────────────────────────────────────────────────────────
  if (orsKey && validIds.length > 0) {
    try {
      const jobs = validIds.map((id, idx) => {
        const open  = params.arrivals?.[id]   ? timeStrToUnix(fecha, params.arrivals[id])   : 0
        const close = params.closeTimes?.[id] ? timeStrToUnix(fecha, params.closeTimes[id]) : vehicleEnd
        const job: Record<string, unknown> = {
          id:       idx + 1,
          location: [coords[id].lng, coords[id].lat],
          service:  300,
        }
        if (open && close && close > open) job.time_windows = [[open, close]]
        return job
      })

      const res = await fetch('https://api.openrouteservice.org/v2/optimization', {
        method:  'POST',
        headers: { Authorization: orsKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobs,
          vehicles: [{
            id: 1, profile: 'driving-car',
            start: [planta.lng, planta.lat],
            end:   [planta.lng, planta.lat],
            time_window: [vehicleStart, vehicleEnd],
          }],
        }),
      })

      if (res.ok) {
        const data = await res.json()
        if (data.routes?.[0]) {
          const steps = (data.routes[0].steps as { type: string; id?: number; arrival: number }[])
            .filter((s) => s.type === 'job')
          const orderedIds: string[] = []
          const arrivals: Record<string, string> = {}
          steps.forEach((s) => {
            const id = validIds[s.id! - 1]
            orderedIds.push(id)
            arrivals[id] = unixToTimeStr(s.arrival)
          })
          stopIds.filter((id) => !coords[id]).forEach((id) => orderedIds.push(id))
          return { orderedIds, arrivals, orsOk: true }
        }
      }
    } catch {
      // ORS no disponible — usar fallback local
    }
  }

  // ── Fallback: nearest-neighbor local ─────────────────────────────────────
  if (validIds.length === 0) {
    return { orderedIds: stopIds, arrivals: {}, orsOk: false }
  }
  const orderedIds = nearestNeighborOrder(stopIds, coords, planta)
  const arrivals   = estimateArrivals(orderedIds, coords, planta, vehicleStart)
  return { orderedIds, arrivals, orsOk: false }
}

export function formatDespachoFecha(fecha: string): string {
  const d = new Date(fecha + 'T12:00:00')
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}
