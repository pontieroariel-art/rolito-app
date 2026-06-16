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

// Llama ORS Optimization y devuelve los IDs ordenados + llegadas estimadas
export async function optimizeStopOrder(params: {
  stopIds:   string[]
  coords:    Record<string, { lat: number; lng: number }>
  arrivals?: Record<string, string>  // horarioApertura/Cierre por stopId
  closeTimes?: Record<string, string>
  fecha:     string
  departure: string  // 'HH:MM'
  planta:    { lat: number; lng: number }
  orsKey:    string
}): Promise<{ orderedIds: string[]; arrivals: Record<string, string>; orsOk: boolean; orsError?: string }> {
  const { stopIds, coords, fecha, departure, planta, orsKey } = params

  const validIds = stopIds.filter((id) => coords[id])
  if (validIds.length === 0) return { orderedIds: stopIds, arrivals: {}, orsOk: false, orsError: 'Sin coordenadas' }

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

  const jobs = validIds.map((id, idx) => {
    const open  = params.arrivals?.[id]  ? timeStrToUnix(fecha, params.arrivals[id])   : 0
    const close = params.closeTimes?.[id] ? timeStrToUnix(fecha, params.closeTimes[id]) : vehicleEnd
    const job: Record<string, unknown> = {
      id:       idx + 1,
      location: [coords[id].lng, coords[id].lat],
      service:  300,
    }
    if (open && close && close > open) job.time_windows = [[open, close]]
    return job
  })

  try {
    const res = await fetch('https://api.openrouteservice.org/v2/optimization', {
      method:  'POST',
      headers: { Authorization: orsKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobs,
        vehicles: [{
          id: 1, profile: 'driving-hgv',
          start: [planta.lng, planta.lat],
          end:   [planta.lng, planta.lat],
          time_window: [vehicleStart, vehicleEnd],
        }],
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      const msg = data?.error?.message ?? data?.message ?? `HTTP ${res.status}`
      console.error('[ORS] Error API:', res.status, data)
      throw new Error(msg)
    }
    if (!data.routes?.[0]) {
      const unassigned = data.unassigned?.length ?? 0
      const msg = unassigned > 0 ? `${unassigned} paradas sin asignar (HGV sin ruta disponible)` : 'Sin solución ORS'
      console.error('[ORS] Sin solución:', data)
      throw new Error(msg)
    }

    const steps = (data.routes[0].steps as { type: string; id?: number; arrival: number }[])
      .filter((s) => s.type === 'job')

    const orderedIds: string[] = []
    const arrivals: Record<string, string> = {}
    steps.forEach((s) => {
      const id = validIds[s.id! - 1]
      orderedIds.push(id)
      arrivals[id] = unixToTimeStr(s.arrival)
    })
    // Ids sin coordenadas van al final
    stopIds.filter((id) => !coords[id]).forEach((id) => orderedIds.push(id))
    return { orderedIds, arrivals, orsOk: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    console.warn('[ORS] Fallback a orden original:', msg)
    return { orderedIds: stopIds, arrivals: {}, orsOk: false, orsError: msg }
  }
}

export function formatDespachoFecha(fecha: string): string {
  const d = new Date(fecha + 'T12:00:00')
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}
