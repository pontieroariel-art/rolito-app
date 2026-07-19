import {
  collection, doc, setDoc, onSnapshot,
  query, where, Timestamp, runTransaction, serverTimestamp,
} from 'firebase/firestore'

import { db } from './firebase'
import { Despacho } from '../types'
import { haversineKm, nearestNeighborOrder, timeStrToUnix, unixToTimeStr } from '../utils/routeMath'
import { fetchOrsDirections, OrsAvoidPolygons } from './orsService'

export const despachoId = (fecha: string, driverId: string) =>
  `${fecha}_${driverId.replace(/[^a-zA-Z0-9]/g, '_')}`

export const saveDespacho = (d: Despacho): Promise<void> =>
  setDoc(doc(db, 'despachos', d.id), d, { merge: true })

// Actualiza SOLO los campos que devuelve `mutate`, leyendo el despacho fresco
// del servidor dentro de una transacción — no el estado local (posiblemente
// desactualizado) del componente. Evita que dos admins editando el mismo
// despacho casi al mismo tiempo se pisen cambios en silencio: a diferencia de
// `saveDespacho` (que reemplaza el documento entero con lo que el cliente
// tenía en memoria), acá el patch se computa a partir del valor vigente en el
// servidor en el momento del commit, y Firestore reintenta la transacción si
// el documento cambió mientras tanto. No hace nada si el despacho todavía no
// existe (se crea recién al confirmar, vía saveDespacho).
export async function updateDespacho(
  id: string,
  mutate: (current: Despacho) => Partial<Despacho>,
): Promise<void> {
  const ref = doc(db, 'despachos', id)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const current = { ...snap.data(), id: snap.id } as Despacho
    tx.update(ref, mutate(current) as Record<string, unknown>)
  })
}

type DespachoItemKind = 'order' | 'visita' | 'programa'

function itemCollection(kind: DespachoItemKind): string {
  return kind === 'order' ? 'orders' : kind === 'visita' ? 'visitas-puntuales' : 'programas-visita'
}

// Mueve un ítem (pedido/visita/programa) a otro chofer y, si el despacho de
// origen ya estaba confirmado, lo quita de su lista de paradas — todo en UNA
// transacción. Antes eran escrituras sueltas encadenadas: si fallaba la del
// despacho, el pedido quedaba reasignado pero el despacho viejo seguía
// listándolo (estado inconsistente). La transacción lee el despacho fresco del
// servidor y hace todo atómico: o se aplica completo o no se aplica nada.
export async function moveItemAtomic(params: {
  fecha:          string
  dndId:          string
  item:           { kind: DespachoItemKind; id: string }
  from:           string
  to:             string
  flagModifiedTo: boolean
}): Promise<void> {
  const { fecha, dndId, item, from, to, flagModifiedTo } = params
  const newDriverId = to === 'sin_asignar' ? null : to

  const fromRef = from !== 'sin_asignar' ? doc(db, 'despachos', despachoId(fecha, from)) : null
  const toRef   = flagModifiedTo && to !== 'sin_asignar' ? doc(db, 'despachos', despachoId(fecha, to)) : null
  const itemRef = doc(db, itemCollection(item.kind), item.id)

  await runTransaction(db, async (tx) => {
    // Todas las lecturas ANTES de cualquier escritura (requisito de Firestore).
    const fromSnap = fromRef ? await tx.get(fromRef) : null
    const toSnap   = toRef   ? await tx.get(toRef)   : null

    if (item.kind === 'order') tx.update(itemRef, { driverId: newDriverId, updatedAt: serverTimestamp() })
    else                        tx.update(itemRef, { driverId: newDriverId })

    if (fromSnap?.exists() && fromSnap.data().status === 'confirmado') {
      const orderIds = ((fromSnap.data().orderIds ?? []) as string[]).filter((x) => x !== dndId)
      tx.update(fromRef!, { orderIds, modifiedAfterConfirm: true })
    }
    if (toSnap?.exists() && toSnap.data().status === 'confirmado') {
      tx.update(toRef!, { modifiedAfterConfirm: true })
    }
  })
}

// Transfiere varias paradas de un chofer a otro (reasignación operativa) y las
// quita del despacho de origen, en una sola transacción — mismo motivo de
// atomicidad que moveItemAtomic, pero para N paradas a la vez.
export async function transferItemsAtomic(params: {
  fecha:      string
  fromDriver: string
  toDriver:   string
  motivo:     string
  items:      { kind: DespachoItemKind; id: string; dndId: string }[]
}): Promise<void> {
  const { fecha, fromDriver, toDriver, motivo, items } = params
  const fromRef = doc(db, 'despachos', despachoId(fecha, fromDriver))
  const dndIds  = items.map((i) => i.dndId)

  await runTransaction(db, async (tx) => {
    const fromSnap = await tx.get(fromRef)   // lectura antes de las escrituras

    for (const it of items) {
      const ref = doc(db, itemCollection(it.kind), it.id)
      if (it.kind === 'order') {
        tx.update(ref, {
          driverId:           toDriver,
          reasignado:         true,
          choferOriginal:     fromDriver,
          motivoReasignacion: motivo || 'Reasignación operativa',
          updatedAt:          serverTimestamp(),
        })
      } else {
        tx.update(ref, { driverId: toDriver })
      }
    }

    if (fromSnap.exists()) {
      const orderIds = ((fromSnap.data().orderIds ?? []) as string[]).filter((x) => !dndIds.includes(x))
      tx.update(fromRef, { orderIds, modifiedAfterConfirm: true })
    }
  })
}

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

// ── Estimación de horarios de llegada (local, sin API — siempre disponible) ──

function estimateArrivals(
  orderedIds: string[],
  coords:     Record<string, { lat: number; lng: number }>,
  origin:     { lat: number; lng: number },
  departureUnix: number,
  serviceMin = 5,
): Record<string, string> {
  const AVG_SPEED_KMH = 30
  let t = departureUnix
  let pos = origin
  const out: Record<string, string> = {}
  for (const id of orderedIds) {
    if (!coords[id]) continue
    const dist = haversineKm(pos, coords[id])
    t   += (dist / AVG_SPEED_KMH) * 3600 + serviceMin * 60
    pos  = coords[id]
    out[id] = unixToTimeStr(t)
  }
  return out
}

export interface RouteZonaProhibida {
  polygon: { lat: number; lng: number }[]
}

// ── Orden por vecino más cercano → ORS Directions (camino real + duración
// real de cada tramo, con avoid_polygons) → fallback local si ORS falla ──
//
// Reemplaza al viejo intento de pegarle al endpoint público de ORS
// "Optimization", que nunca funcionó (siempre caía al fallback local sin que
// nadie lo notara). Este es el mismo enfoque, ya probado en producción, que
// usa la planificación semanal (MapaPlanificacion) desde hace tiempo.
export async function optimizeStopOrder(params: {
  stopIds:     string[]
  coords:      Record<string, { lat: number; lng: number }>
  fecha:       string
  departure:   string
  planta:      { lat: number; lng: number }
  zonasProhibidas?:   RouteZonaProhibida[]
  tiempoServicioMin?: number
}): Promise<{ orderedIds: string[]; arrivals: Record<string, string>; orsOk: boolean; orsError?: string }> {
  const { stopIds, coords, fecha, departure, planta, zonasProhibidas, tiempoServicioMin = 5 } = params

  const validStops = stopIds
    .filter((id) => coords[id])
    .map((id) => ({ id, ...coords[id] }))
  const noCoordIds = stopIds.filter((id) => !coords[id])

  if (validStops.length === 0) {
    return { orderedIds: stopIds, arrivals: {}, orsOk: false }
  }

  const orderedStops = nearestNeighborOrder(planta, validStops)
  const orderedIds   = [...orderedStops.map((s) => s.id), ...noCoordIds]
  const vehicleStart  = timeStrToUnix(fecha, departure)

  // ORS Directions se resuelve server-side (Cloud Function `orsDirections`): la
  // API key ya no viaja al navegador. Si la function falla (ORS caído, sin
  // cuota), se usa el fallback local, que siempre da un resultado.
  const coordinates  = [planta, ...orderedStops, planta].map((p) => [p.lng, p.lat])
  const zonasActivas = (zonasProhibidas ?? []).filter((z) => z.polygon.length >= 3)
  const avoidPolygons: OrsAvoidPolygons | null = zonasActivas.length > 0
    ? {
        type: 'MultiPolygon',
        coordinates: zonasActivas.map((z) => {
          const ring = z.polygon.map((p) => [p.lng, p.lat])
          return [[...ring, ring[0]]]
        }),
      }
    : null

  try {
    const { segments } = await fetchOrsDirections(coordinates, avoidPolygons)

    const arrivals: Record<string, string> = {}
    let cursor = vehicleStart
    orderedStops.forEach((stop, idx) => {
      cursor += segments[idx]?.duration ?? 0
      arrivals[stop.id] = unixToTimeStr(cursor)
      cursor += tiempoServicioMin * 60
    })
    return { orderedIds, arrivals, orsOk: true }
  } catch (err) {
    // ORS no disponible — usar fallback local (siempre da un resultado)
    return {
      orderedIds,
      arrivals: estimateArrivals(orderedIds, coords, planta, vehicleStart, tiempoServicioMin),
      orsOk: false,
      orsError: err instanceof Error ? err.message : 'Error ORS',
    }
  }
}

export function formatDespachoFecha(fecha: string): string {
  const d = new Date(fecha + 'T12:00:00')
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}
