import {
  collection, doc, setDoc, onSnapshot,
  query, where, Timestamp, runTransaction, serverTimestamp,
} from 'firebase/firestore'

import { db } from './firebase'
import { Despacho, Order } from '../types'
import { haversineKm, nearestNeighborOrder, timeStrToUnix, unixToTimeStr } from '../utils/routeMath'
import { fetchOrsDirections, OrsAvoidPolygons } from './orsService'
import { todayString } from '../utils/helpers'

// vuelta 1 (o sin especificar) mantiene el id histórico `fecha_email` — cero
// migración para los despachos ya existentes. Solo vuelta 2+ suma un sufijo,
// para que un mismo chofer pueda tener despachos independientes el mismo día
// ("sale, entrega, vuelve a cargar").
export const despachoId = (fecha: string, driverId: string, vuelta = 1) =>
  `${fecha}_${driverId.replace(/[^a-zA-Z0-9]/g, '_')}${vuelta > 1 ? `_v${vuelta}` : ''}`

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
  fromVuelta?:    number
  toVuelta?:      number
  flagModifiedTo: boolean
}): Promise<void> {
  const { fecha, dndId, item, from, to, fromVuelta = 1, toVuelta = 1, flagModifiedTo } = params
  const newDriverId = to === 'sin_asignar' ? null : to

  const fromRef = from !== 'sin_asignar' ? doc(db, 'despachos', despachoId(fecha, from, fromVuelta)) : null
  const toRef   = flagModifiedTo && to !== 'sin_asignar' ? doc(db, 'despachos', despachoId(fecha, to, toVuelta)) : null
  const itemRef = doc(db, itemCollection(item.kind), item.id)

  await runTransaction(db, async (tx) => {
    // Todas las lecturas ANTES de cualquier escritura (requisito de Firestore).
    const fromSnap = fromRef ? await tx.get(fromRef) : null
    const toSnap   = toRef   ? await tx.get(toRef)   : null

    if (item.kind === 'order') tx.update(itemRef, { driverId: newDriverId, vuelta: toVuelta, updatedAt: serverTimestamp() })
    else                        tx.update(itemRef, { driverId: newDriverId, vuelta: toVuelta })

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
  fromVuelta?: number
  // Transferir siempre apunta a la vuelta 1 del camión destino — mover entre
  // vueltas puntuales de dos camiones distintos es un caso de uso que no
  // existe hoy (queda fuera de alcance).
  toVuelta?:   number
}): Promise<void> {
  const { fecha, fromDriver, toDriver, motivo, items, fromVuelta = 1, toVuelta = 1 } = params
  const fromRef = doc(db, 'despachos', despachoId(fecha, fromDriver, fromVuelta))
  const dndIds  = items.map((i) => i.dndId)

  await runTransaction(db, async (tx) => {
    const fromSnap = await tx.get(fromRef)   // lectura antes de las escrituras

    for (const it of items) {
      const ref = doc(db, itemCollection(it.kind), it.id)
      if (it.kind === 'order') {
        tx.update(ref, {
          driverId:           toDriver,
          vuelta:             toVuelta,
          reasignado:         true,
          choferOriginal:     fromDriver,
          motivoReasignacion: motivo || 'Reasignación operativa',
          updatedAt:          serverTimestamp(),
        })
      } else {
        tx.update(ref, { driverId: toDriver, vuelta: toVuelta })
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

// Todos los despachos de un chofer para un día (puede haber más de uno —
// varias vueltas). Usado por el lado chofer, que antes asumía un único
// despacho por chofer/día (lectura directa por id de vuelta 1).
export const subscribeDespachosForDriver = (
  fecha: string,
  driverEmail: string,
  cb: (despachos: Despacho[]) => void,
): () => void => {
  const q = query(
    collection(db, 'despachos'),
    where('fecha', '==', fecha),
    where('driverId', '==', driverEmail),
  )
  return onSnapshot(q, (snap) => {
    const despachos = snap.docs
      .map((d) => ({ ...d.data(), id: d.id } as Despacho))
      .sort((a, b) => (a.vuelta ?? 1) - (b.vuelta ?? 1))
    cb(despachos)
  })
}

// Igual que subscribeDespachosForDriver pero buscando por ayudanteEmail —
// para el chofer con subrol "ayudante", que ve el/los despacho(s) del chofer
// principal al que fue asignado.
export const subscribeDespachosForAyudante = (
  fecha: string,
  ayudanteEmail: string,
  cb: (despachos: Despacho[]) => void,
): () => void => {
  const q = query(
    collection(db, 'despachos'),
    where('fecha', '==', fecha),
    where('ayudanteEmail', '==', ayudanteEmail),
  )
  return onSnapshot(q, (snap) => {
    const despachos = snap.docs
      .map((d) => ({ ...d.data(), id: d.id } as Despacho))
      .sort((a, b) => (a.vuelta ?? 1) - (b.vuelta ?? 1))
    cb(despachos)
  })
}

// El chofer puede tener más de un despacho el mismo día (varias vueltas). El
// lado chofer (banner de camión/planta/hora, mapa de ruta) solo puede
// mostrar uno a la vez: el confirmado de vuelta más alta (el viaje en curso
// o el próximo a arrancar), o si ninguno está confirmado todavía, el primero.
export function pickActiveDespacho(despachos: Despacho[]): Despacho | null {
  if (despachos.length === 0) return null
  const confirmados = despachos.filter((d) => d.status === 'confirmado')
  return confirmados.length > 0 ? confirmados[confirmados.length - 1] : despachos[0]
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

// Ordena los pedidos pendientes según la secuencia de paradas que armó
// logística en los despachos confirmados (`despacho.orderIds`), concatenando
// las vueltas en el orden en que vienen los despachos. Los pedidos que no
// están en ningún despacho van al final; si no hay orden de despacho, devuelve
// la lista tal cual. Lo usan el mapa de ruta Y la lista de entregas del chofer
// —así las dos muestran la MISMA ruta que definió el encargado (antes la lista
// salía ordenada por fecha, arbitraria, y no coincidía con el reorden manual).
export function ordenarPorRutaDespacho(pending: Order[], despachos: Despacho[]): Order[] {
  const orderIdOrder = despachos
    .filter((d) => d.status === 'confirmado')
    .flatMap((d) => (d.orderIds ?? []).filter((x) => x.startsWith('o:')).map((x) => x.slice(2)))
  if (orderIdOrder.length === 0) return pending

  const byId   = new Map(pending.map((o) => [o.id, o]))
  const sorted = orderIdOrder.map((id) => byId.get(id)).filter(Boolean) as Order[]
  const inSet  = new Set(orderIdOrder)
  const extra  = pending.filter((o) => !inSet.has(o.id))
  return [...sorted, ...extra]
}

export function formatDespachoFecha(fecha: string): string {
  const d = new Date(fecha + 'T12:00:00')
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function todayStr(): string {
  return todayString()
}
