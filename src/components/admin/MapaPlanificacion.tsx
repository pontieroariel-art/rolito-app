import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { X, SlidersHorizontal, RotateCcw, ChevronUp, ChevronDown } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import { GoogleMap, Marker, InfoWindow, Polyline, Polygon } from '@react-google-maps/api'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { summarizeProducts, toDateStr as dateToStr, todayString, normalizeAddress } from '../../utils/helpers'
import { addVisitaPuntual, deleteVisitaPuntual } from '../../services/visitasService'
import { useVisitasPuntuales, visitasParaFecha } from '../../hooks/useVisitas'
import { useZonasProhibidas } from '../../hooks/useZonas'
import { saveZonas, ZonaProhibida } from '../../services/zonasService'
import { Order, UserProfile, Despacho, getPrimaryAddress, PLANTAS, PlantaId } from '../../types'
import { nearestNeighborOrder, timeStrToUnix, unixToTimeStr, LatLng } from '../../utils/routeMath'
import { fetchOrsDirections, OrsAvoidPolygons } from '../../services/orsService'
import { subscribeDespachosByFecha, despachoId, updateDespacho } from '../../services/despachoService'
import { setClienteOcultoMapa, restoreClientesOcultosMapa } from '../../services/userService'
import { useAuth } from '../../context/AuthContext'

// ── Constantes ────────────────────────────────────────────────────────────────

const DRIVER_COLORS = ['#E53935', '#F57C00', '#7B1FA2', '#1565C0', '#E91E63', '#F9A825', '#2E7D32', '#00838F']

const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: 'poi',               stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',           stylers: [{ visibility: 'off' }] },
  { featureType: 'road',              elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative',    elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
]

// Cache de geocodificación a nivel de módulo — persiste entre montajes
const GEO_CACHE = new Map<string, { lat: number; lng: number } | null>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function orderDateStr(o: Order): string {
  if (!o.date) return ''
  // String guardada directamente (legacy)
  if (typeof o.date === 'string') return (o.date as string).slice(0, 10)
  // Timestamp normal con toDate()
  const d = o.date as any
  if (typeof d.toDate === 'function') return dateToStr(d.toDate())
  // Objeto plano { seconds } (cache offline de Firestore)
  if (typeof d.seconds === 'number') return dateToStr(new Date(d.seconds * 1000))
  return ''
}

function driverColor(email: string, choferes: UserProfile[]): string {
  const idx = choferes.findIndex((c) => c.email === email)
  return idx >= 0 ? DRIVER_COLORS[idx % DRIVER_COLORS.length] : '#F59E0B'
}


// timeStrToUnix, unixToTimeStr, nearestNeighborOrder: ver src/utils/routeMath.ts
// (antes duplicadas acá, ahora compartidas con despachoService.optimizeStopOrder)

const GOOGLE_WAYPOINT_CHUNK = 23 // límite de Google Directions: 23 waypoints + origen/destino

function directionsRoute(request: google.maps.DirectionsRequest): Promise<google.maps.DirectionsResult> {
  return new Promise((resolve, reject) => {
    new google.maps.DirectionsService().route(request, (result, status) => {
      if (status === 'OK' && result) resolve(result)
      else reject(new Error(`DirectionsService: ${status}`))
    })
  })
}

// Fallback a Google Directions cuando ORS falla. Antes se recortaba a las
// primeras 23 paradas (límite de waypoints de Google) y el resto se
// descartaba en silencio — acá se trochea en tramos de a lo sumo 23 y se
// encadena uno detrás del otro (el final de un tramo es el origen del
// siguiente) para que ninguna parada quede afuera, sin importar cuántas sean.
// `optimizeWaypoints: false` — el orden de `stops` ya viene resuelto
// (nearestNeighborOrder o el orden guardado en el despacho); si se dejara que
// Google reoptimice acá, un orden manual ya guardado quedaría descartado en
// silencio justo en el caso (ORS caído) en el que más se necesita respetarlo.
async function computeGoogleFallbackRoute(
  planta: LatLng,
  stops: { id: string; lat: number; lng: number }[],
): Promise<{ path: LatLng[]; labels: Record<string, string> }> {
  const chunks: (typeof stops)[] = []
  for (let i = 0; i < stops.length; i += GOOGLE_WAYPOINT_CHUNK) {
    chunks.push(stops.slice(i, i + GOOGLE_WAYPOINT_CHUNK))
  }

  const path: LatLng[] = []
  const labels: Record<string, string> = {}
  let cursor: LatLng = planta
  let labelOffset = 0

  for (const chunk of chunks) {
    const last      = chunk[chunk.length - 1]
    const waypoints = chunk.slice(0, -1)

    const result = await directionsRoute({
      origin:            new google.maps.LatLng(cursor.lat, cursor.lng),
      destination:       new google.maps.LatLng(last.lat, last.lng),
      waypoints:         waypoints.map((w) => ({ location: new google.maps.LatLng(w.lat, w.lng), stopover: true })),
      optimizeWaypoints: false,
      travelMode:        google.maps.TravelMode.DRIVING,
    })

    waypoints.forEach((w, idx) => { labels[w.id] = String(labelOffset + idx + 1) })
    labels[last.id] = String(labelOffset + chunk.length)
    labelOffset += chunk.length

    result.routes[0].overview_path.forEach((p) => path.push({ lat: p.lat(), lng: p.lng() }))
    cursor = { lat: last.lat, lng: last.lng }
  }

  // Tramo final de vuelta a la planta
  const finalLeg = await directionsRoute({
    origin:      new google.maps.LatLng(cursor.lat, cursor.lng),
    destination: new google.maps.LatLng(planta.lat, planta.lng),
    travelMode:  google.maps.TravelMode.DRIVING,
  })
  finalLeg.routes[0].overview_path.forEach((p) => path.push({ lat: p.lat(), lng: p.lng() }))

  return { path, labels }
}

function clientInitials(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name
  return first.slice(0, 3).toUpperCase()
}

function makeOrderPin(fill: string, label: string) {
  const fontSize = label.length >= 3 ? 9 : 12
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40">` +
    `<path d="M16 0C7.2 0 0 7.2 0 16c0 11 16 24 16 24s16-13 16-24C32 7.2 24.8 0 16 0z" fill="${fill}"/>` +
    `<text x="16" y="21" font-size="${fontSize}" font-weight="bold" text-anchor="middle" fill="white" font-family="sans-serif">${label}</text>` +
    `</svg>`,
  )
  return {
    url:        `data:image/svg+xml;charset=UTF-8,${svg}`,
    scaledSize: new google.maps.Size(32, 40),
    anchor:     new google.maps.Point(16, 40),
  }
}

// driverColor: si se pasa, el pin toma ese color (visita asignada a chofer)
function makeClientPin(driverColor?: string) {
  const outer = driverColor ?? '#3CB8C4'
  // Color del círculo interior: versión más clara del color exterior
  const inner = driverColor ? `${driverColor}55` : '#B3DCE8'
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46">` +
    `<path d="M18 1C9.2 1 2 8.2 2 17c0 12 16 28 16 28s16-16 16-28C34 8.2 26.8 1 18 1z" fill="${outer}" stroke="#1A1A1A" stroke-width="2"/>` +
    `<circle cx="18" cy="15.5" r="10.5" fill="${inner}" stroke="#1A1A1A" stroke-width="1.8"/>` +
    `<circle cx="18" cy="11.5" r="3.5" fill="#FFF2C0" stroke="#1A1A1A" stroke-width="1.3"/>` +
    `<path d="M11.5 23.5 Q12 18.5 18 18.5 Q24 18.5 24.5 23.5" fill="none" stroke="#1A1A1A" stroke-width="1.8" stroke-linecap="round"/>` +
    `</svg>`,
  )
  return {
    url:        `data:image/svg+xml;charset=UTF-8,${svg}`,
    scaledSize: new google.maps.Size(36, 46),
    anchor:     new google.maps.Point(18, 46),
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrderMarker {
  id:        string
  lat:       number
  lng:       number
  label:     string
  color:     string
  title:     string
  subtitle:  string
  driver?:   string
  clientId?: string
  address:   string
}

interface ClientMarker {
  id:       string   // uid o uid_addrId — único por marcador
  uid:      string   // uid base del usuario — para visitas
  lat:      number
  lng:      number
  title:    string
  address:  string
  phone:    string
}


// ── Componente ────────────────────────────────────────────────────────────────

interface Props {
  orders:     Order[]
  choferes:   UserProfile[]
  allClients: UserProfile[]
  weekDays:   Date[]
}

export default function MapaPlanificacion({ orders, choferes, allClients, weekDays }: Props) {
  const { isLoaded }       = useGoogleMapsLoader()
  const { visitas }        = useVisitasPuntuales()
  const { zonas }          = useZonasProhibidas()
  const { user: staffUser } = useAuth()
  const mapRef             = useRef<google.maps.Map | null>(null)

  // Clientes que ESTE usuario decidió sacarse de encima en su propio mapa
  // (ej. estaciones de servicio que no coordina) — preferencia personal, no
  // toca el estado del cliente ni lo que ve otro miembro del staff.
  const ocultosMapa = useMemo(
    () => new Set(staffUser?.clientesOcultosMapa ?? []),
    [staffUser?.clientesOcultosMapa],
  )

  const [selectedDate,      setSelectedDate]      = useState(() => todayString())
  const [orderMarkers,      setOrderMarkers]      = useState<OrderMarker[]>([])
  const [clientMarkers,     setClientMarkers]     = useState<ClientMarker[]>([])
  const [geocoding,         setGeocoding]         = useState(false)
  // Apagado por defecto: geocodificar y montar un pin por cada cliente sin
  // pedido (pueden ser miles) es pesado — se activa a pedido con el botón
  // "Mostrar clientes sin pedido", no en cada entrada a la pestaña Mapa.
  const [showAllClients,    setShowAllClients]    = useState(false)
  const [selectedOrder,     setSelectedOrder]     = useState<string | null>(null)
  const [selectedClientId,  setSelectedClientId]  = useState<string | null>(null)
  const [visitaDriverId,    setVisitaDriverId]    = useState<string | null>(null)
  const [visitaSaving,      setVisitaSaving]      = useState(false)
  const [visitaDone,        setVisitaDone]        = useState<Set<string>>(new Set())
  const [plantaChofer,     setPlantaChofer]      = useState<Record<string, PlantaId>>({})
  const [routeLabels,      setRouteLabels]       = useState<Record<string, string>>({})
  const [routeCalculating, setRouteCalculating]  = useState<Record<string, boolean>>({})
  const [routePaths,       setRoutePaths]        = useState<Record<string, { lat: number; lng: number }[]>>({})
  const [routeArrivals,   setRouteArrivals]     = useState<Record<string, string>>({})
  const [routeUnassigned, setRouteUnassigned]   = useState<Record<string, string[]>>({})
  const [horasSalida,     setHorasSalida]       = useState<Record<string, string>>({})
  const [tiempoServicio,  setTiempoServicio]    = useState(20)
  const [drawingMode,      setDrawingMode]       = useState(false)
  const [drawingVertices,  setDrawingVertices]   = useState<{ lat: number; lng: number }[]>([])
  const [newZonaNombre,    setNewZonaNombre]     = useState('')
  const [zonaSaving,       setZonaSaving]        = useState(false)
  // Mobile: el panel lateral (filtros, visitas, zonas) se abre como drawer
  // sobre el mapa en vez de empujarlo — a ese ancho no queda lugar para los dos.
  const [sidebarOpen,      setSidebarOpen]       = useState(false)
  const [despachos,        setDespachos]         = useState<Despacho[]>([])

  // Resetear rutas al cambiar de día
  useEffect(() => {
    setRouteLabels({})
    setRoutePaths({})
    setRouteArrivals({})
    setRouteUnassigned({})
  }, [selectedDate])

  // Despachos del día — misma colección que ya usa la pestaña Despacho, para
  // que el orden de ruta acá respete el que el chofer realmente recibe (antes
  // este componente no tenía ninguna referencia a `despachos` y siempre
  // recalculaba desde cero, ignorando cualquier reorden manual ya guardado).
  useEffect(() => {
    return subscribeDespachosByFecha(selectedDate, setDespachos)
  }, [selectedDate])

  // Un chofer puede tener más de un despacho el mismo día (varias vueltas,
  // ver DespachoBoard) — acá nos quedamos siempre con la vuelta 1: esta
  // pantalla es de planificación general, no de multi-vuelta.
  const despachoByDriver = useMemo(() => {
    const m: Record<string, Despacho> = {}
    despachos.forEach((d) => {
      const existing = m[d.driverId]
      if (!existing || (d.vuelta ?? 1) < (existing.vuelta ?? 1)) m[d.driverId] = d
    })
    return m
  }, [despachos])

  // Pedidos del día seleccionado
  const ordersDay = useMemo(
    () => orders.filter((o) => orderDateStr(o) === selectedDate && !['entregado', 'cancelado'].includes(o.status)),
    [orders, selectedDate],
  )

  // Sucursales sin pedido hoy (una entrada por cada address del cliente)
  const clientsWithoutOrder = useMemo(() => {
    const ids = new Set(ordersDay.map((o) => o.clientId))
    return allClients
      .filter((c) => !ids.has(c.uid))
      .flatMap((c) => {
        const name  = c.razonSocial || c.nombreContacto || c.nombre || c.email
        const phone = c.telefono || c.phone || ''
        if (c.addresses?.length) {
          return c.addresses.map((addr) => ({
            markerId: addr.id ? `${c.uid}_${addr.id}` : c.uid,
            uid:      c.uid,
            title:    addr.nombre ? `${name} – ${addr.nombre}` : name,
            phone:    addr.contactoTelefono || phone,
            address:  addr.address,
            lat:      addr.lat ?? null,
            lng:      addr.lng ?? null,
          }))
        }
        return [{
          markerId: c.uid,
          uid:      c.uid,
          title:    name,
          phone,
          address:  c.address || '',
          lat:      c.lat ?? null,
          lng:      c.lng ?? null,
        }]
      })
  }, [allClients, ordersDay])

  // Geocodificador con cache persistente
  const geocode = useCallback((address: string): Promise<{ lat: number; lng: number } | null> => {
    if (GEO_CACHE.has(address)) return Promise.resolve(GEO_CACHE.get(address) ?? null)
    return new Promise((resolve) => {
      new google.maps.Geocoder().geocode(
        { address: `${address}, Argentina`, componentRestrictions: { country: 'AR' } },
        (results, status) => {
          const pt = status === 'OK' && results?.[0]
            ? { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() }
            : null
          GEO_CACHE.set(address, pt)
          resolve(pt)
        },
      )
    })
  }, [])

  // Geocodificar pedidos del día
  useEffect(() => {
    if (!isLoaded) return
    setGeocoding(true)
    Promise.all(
      ordersDay.map(async (o, i) => {
        const pt = await geocode(o.clientAddress)
        if (!pt) return null
        return {
          id:       o.id,
          ...pt,
          label:    clientInitials(o.clientName),
          color:    o.driverId ? driverColor(o.driverId, choferes) : '#F59E0B',
          title:    o.clientName,
          subtitle: summarizeProducts(o.products),
          driver:   o.driverId ?? undefined,
          clientId: o.clientId,
          address:  o.clientAddress,
        } as OrderMarker
      }),
    ).then((res) => {
      setOrderMarkers(res.filter(Boolean) as OrderMarker[])
      setGeocoding(false)
    })
  }, [isLoaded, ordersDay, choferes, geocode])

  // Visitas puntuales del día seleccionado (de Firestore en tiempo real) —
  // declarado acá arriba (antes vivía después del efecto de geocodificación)
  // porque el efecto de abajo necesita saber qué clientes tienen visita hoy.
  const visitasDelDia = useMemo(
    () => visitasParaFecha(visitas, new Date(selectedDate + 'T12:00:00')),
    [visitas, selectedDate],
  )

  // Geocodificar sucursales sin pedido (usa coords guardadas primero). Los
  // clientes con VISITA agendada hoy se geocodifican siempre (son pocos y el
  // cálculo de ruta los necesita, incluso si el usuario los ocultó en algún
  // momento); el resto — que puede ser toda la cartera, miles de clientes —
  // solo si el usuario los pidió ver con "Mostrar clientes sin pedido" (nunca
  // de entrada al abrir la pestaña Mapa) y no los ocultó individualmente.
  useEffect(() => {
    if (!isLoaded || allClients.length === 0) return
    const visitClientIds = new Set(visitasDelDia.map((v) => v.clientId))
    const toGeocode = showAllClients
      ? clientsWithoutOrder.filter((s) => !ocultosMapa.has(s.uid) || visitClientIds.has(s.uid))
      : clientsWithoutOrder.filter((s) => visitClientIds.has(s.uid))
    if (toGeocode.length === 0) { setClientMarkers([]); return }
    Promise.all(
      toGeocode.map(async (s) => {
        let pt: { lat: number; lng: number } | null = null
        if (s.lat && s.lng) {
          pt = { lat: s.lat, lng: s.lng }
        } else if (s.address) {
          pt = await geocode(s.address)
        }
        if (!pt) return null
        return {
          id:      s.markerId,
          uid:     s.uid,
          ...pt,
          title:   s.title,
          address: s.address,
          phone:   s.phone,
        } as ClientMarker
      }),
    ).then((res) => setClientMarkers(res.filter(Boolean) as ClientMarker[]))
  }, [isLoaded, showAllClients, allClients.length, clientsWithoutOrder, visitasDelDia, ocultosMapa, geocode])

  const clearRoute = useCallback((driverEmail: string) => {
    const idsToRemove = new Set([
      ...orderMarkers.filter((m) => m.driver === driverEmail).map((m) => m.id),
      ...visitasDelDia.filter((v) => v.driverId === driverEmail).map((v) => v.id),
    ])
    setRoutePaths((prev)    => { const n = { ...prev }; delete n[driverEmail]; return n })
    setRouteUnassigned((prev) => { const n = { ...prev }; delete n[driverEmail]; return n })
    setRouteLabels((prev)   => { const n = { ...prev }; idsToRemove.forEach((id) => delete n[id]); return n })
    setRouteArrivals((prev) => { const n = { ...prev }; idsToRemove.forEach((id) => delete n[id]); return n })
  }, [orderMarkers, visitasDelDia])

  // Si ya existe un despacho confirmado/en curso para ese chofer/día, respeta
  // ese orden (`orderIds`, con prefijo `o:`/`v:` — mismo formato que arma
  // useDespachoBoard.ts) en vez de recalcular desde cero, para no ignorar un
  // reordenamiento manual ya hecho (acá o en la pestaña Despacho). Las
  // paradas nuevas que no estén en `orderIds` (ej. un pedido asignado después
  // de confirmar) se agregan al final por vecino más cercano desde la última
  // parada conocida.
  function resolveStopOrder<T extends { id: string } & LatLng>(
    planta:   LatLng,
    all:      T[],
    orderIds: string[] | undefined,
  ): T[] {
    if (!orderIds || orderIds.length === 0) return nearestNeighborOrder(planta, all)
    const byId = new Map(all.map((s) => [s.id, s]))
    const used = new Set<string>()
    const ordered: T[] = []
    orderIds.forEach((dndId) => {
      const sep = dndId.indexOf(':')
      const id  = sep >= 0 ? dndId.slice(sep + 1) : dndId
      const stop = byId.get(id)
      if (stop && !used.has(id)) { ordered.push(stop); used.add(id) }
    })
    const missing = all.filter((s) => !used.has(s.id))
    if (missing.length === 0) return ordered
    const lastPoint = ordered.length > 0 ? ordered[ordered.length - 1] : planta
    return [...ordered, ...nearestNeighborOrder(lastPoint, missing)]
  }

  type RouteStop = { id: string; clientId: string; lat: number; lng: number; address: string }

  // Ejecuta el cálculo de ruta (ORS → fallback Google) para un orden de
  // paradas ya resuelto. Separado de calculateRoute para que el reordenamiento
  // manual (handleManualReorder/moveStop) pueda recalcular la polilínea de
  // inmediato con el nuevo orden, en vez de depender de que llegue el
  // próximo snapshot de `despachos` (que además dejaría de servir si se
  // llama antes de que se confirme el despacho la primera vez).
  const runRouteCalculation = useCallback(async (driverEmail: string, orderedStops: RouteStop[]) => {
    if (orderedStops.length === 0 || !isLoaded) return
    const plantaId = plantaChofer[driverEmail] ?? 'torcuato'
    const planta   = PLANTAS[plantaId]

    // Dirección real de cada parada (no necesariamente la principal del
    // cliente) — un grupo empresario tiene un horarioApertura/Cierre distinto
    // por sucursal, así que el chequeo de "fuera de horario" tiene que
    // compararse contra la dirección exacta de esa parada, no contra
    // getPrimaryAddress(cliente).
    const addressByStopId = new Map(orderedStops.map((s) => [s.id, s.address]))

    setRouteCalculating((prev) => ({ ...prev, [driverEmail]: true }))

    try {
      const departureTime  = horasSalida[driverEmail] ?? '07:00'
      const vehicleStart   = timeStrToUnix(selectedDate, departureTime)
      const serviceSeconds = tiempoServicio * 60

      // ORS Directions server-side (Cloud Function orsDirections): camino real
      // con avoid_polygons + duración real de cada tramo. La API key ya no
      // viaja en el bundle. Si falla, se cae al fallback de Google Maps.
      const coordinates = [planta, ...orderedStops, planta].map((p) => [p.lng, p.lat])
      const zonasActivas = zonas.filter((z) => z.activa && z.polygon.length >= 3)
      const avoidPolygons: OrsAvoidPolygons | null = zonasActivas.length > 0
        ? {
            type: 'MultiPolygon',
            coordinates: zonasActivas.map((z) => {
              const ring = z.polygon.map((p) => [p.lng, p.lat])
              return [[...ring, ring[0]]]
            }),
          }
        : null

      const { geometry, segments } = await fetchOrsDirections(coordinates, avoidPolygons)

      const path = geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
      setRoutePaths((prev) => ({ ...prev, [driverEmail]: path }))

      // Etiquetas de orden + horario de llegada estimado, a partir de la
      // duración real de cada tramo (segments[0] = planta→parada 1, etc.)
      const labels:     Record<string, string> = {}
      const arrivals:   Record<string, string> = {}
      const unassigned: string[] = []
      let cursor = vehicleStart
      orderedStops.forEach((stop, idx) => {
        cursor += segments[idx]?.duration ?? 0
        labels[stop.id]   = String(idx + 1)
        arrivals[stop.id] = unixToTimeStr(cursor)

        const client      = allClients.find((c) => c.uid === stop.clientId)
        const stopAddress = addressByStopId.get(stop.id)
        const addr        = client
          ? (stopAddress && client.addresses?.find((a) => normalizeAddress(a.address) === normalizeAddress(stopAddress))) || getPrimaryAddress(client)
          : null
        const open   = addr?.horarioApertura ? timeStrToUnix(selectedDate, addr.horarioApertura) : null
        const close  = addr?.horarioCierre   ? timeStrToUnix(selectedDate, addr.horarioCierre)   : null
        if ((open && cursor < open) || (close && cursor > close)) unassigned.push(stop.id)

        cursor += serviceSeconds
      })
      setRouteLabels((prev)     => ({ ...prev, ...labels }))
      setRouteArrivals((prev)   => ({ ...prev, ...arrivals }))
      setRouteUnassigned((prev) => ({ ...prev, [driverEmail]: unassigned }))

      setRouteCalculating((prev) => ({ ...prev, [driverEmail]: false }))
    } catch (err) {
      console.warn('ORS falló, fallback a Google Maps:', err)
      try {
        const { path, labels } = await computeGoogleFallbackRoute(planta, orderedStops)
        setRoutePaths((prev) => ({ ...prev, [driverEmail]: path }))
        setRouteLabels((prev) => ({ ...prev, ...labels }))
        // El fallback de Google no calcula horarios de llegada — se limpian los
        // viejos en vez de dejar mostrando el chequeo de horario de un cálculo
        // anterior (con otro orden) como si siguiera vigente.
        setRouteArrivals((prev) => {
          const n = { ...prev }
          orderedStops.forEach((s) => delete n[s.id])
          return n
        })
        setRouteUnassigned((prev) => ({ ...prev, [driverEmail]: [] }))
      } catch (fallbackErr) {
        console.warn('Fallback a Google Maps también falló:', fallbackErr)
      } finally {
        setRouteCalculating((prev) => ({ ...prev, [driverEmail]: false }))
      }
    }
  }, [plantaChofer, isLoaded, zonas, horasSalida, tiempoServicio, allClients, selectedDate])

  // Calcular ruta: respeta el orden ya guardado en el despacho (si existe) →
  // ORS Directions (camino real, avoid_polygons, y duración real de cada
  // tramo para estimar llegadas). El endpoint público de ORS "Optimization"
  // no existe (nunca funcionó); por eso el orden se resuelve acá y solo se
  // usa ORS para el trazado. `forceAuto` descarta el orden guardado y
  // recalcula desde cero por vecino más cercano (botón "Recalcular automático").
  const calculateRoute = useCallback((driverEmail: string, forceAuto = false) => {
    const plantaId = plantaChofer[driverEmail] ?? 'torcuato'
    const planta   = PLANTAS[plantaId]

    const orderWps = orderMarkers.filter((m) => m.driver === driverEmail)
    // id: v.id (no v.clientId) — mismo formato `v:{visita.id}` que usa
    // useDespachoBoard.ts al persistir `despacho.orderIds`. Antes acá se
    // usaba clientId, así que el orden guardado desde la pestaña Despacho
    // nunca matcheaba (resolveStopOrder buscaba por clientId un id que en
    // realidad era el de la visita) y quedaba siempre reordenado desde cero.
    const visitWps = visitasDelDia
      .filter((v) => v.driverId === driverEmail)
      .flatMap((v) => {
        const cm = clientMarkers.find((c) => c.uid === v.clientId)
        return cm ? [{ id: v.id, clientId: v.clientId, lat: cm.lat, lng: cm.lng, address: cm.address }] : []
      })
    const all: RouteStop[] = [
      ...orderWps.map((m) => ({ id: m.id, clientId: m.clientId ?? '', lat: m.lat, lng: m.lng, address: m.address })),
      ...visitWps,
    ]
    if (all.length === 0 || !isLoaded) return

    const orderIds     = forceAuto ? undefined : despachoByDriver[driverEmail]?.orderIds
    const orderedStops = resolveStopOrder(planta, all, orderIds)
    void runRouteCalculation(driverEmail, orderedStops)
  }, [plantaChofer, orderMarkers, visitasDelDia, clientMarkers, isLoaded, despachoByDriver, runRouteCalculation])

  // Auto-fit bounds — `clientMarkers` ya viene acotado por el efecto de
  // geocodificación (todos los clientes sin pedido si el toggle está
  // prendido, o solo los que tienen visita hoy si está apagado), no hace
  // falta volver a filtrar acá.
  useEffect(() => {
    if (!mapRef.current) return
    const pts = [...orderMarkers, ...clientMarkers]
    if (pts.length === 0) return
    if (pts.length === 1) { mapRef.current.panTo(pts[0]); mapRef.current.setZoom(14); return }
    const bounds = new google.maps.LatLngBounds()
    pts.forEach((p) => bounds.extend(p))
    mapRef.current.fitBounds(bounds, 60)
  }, [orderMarkers, clientMarkers])

  // Choferes activos en el día (con pedidos O con visitas agendadas)
  const activeDrivers = choferes.filter((c) =>
    ordersDay.some((o) => o.driverId === c.email) ||
    visitasDelDia.some((v) => v.driverId === c.email),
  )

  // Paradas de cada chofer en el orden actual de la ruta (una vez calculada),
  // para la lista compacta con reordenamiento manual.
  const driverStops = useMemo(() => {
    const map: Record<string, { id: string; kind: 'o' | 'v'; title: string }[]> = {}
    activeDrivers.forEach((c) => {
      const stops: { id: string; kind: 'o' | 'v'; title: string; label: number }[] = []
      orderMarkers.filter((m) => m.driver === c.email).forEach((m) => {
        const lbl = routeLabels[m.id]
        if (lbl) stops.push({ id: m.id, kind: 'o', title: m.title, label: Number(lbl) })
      })
      visitasDelDia.filter((v) => v.driverId === c.email).forEach((v) => {
        const lbl = routeLabels[v.id]
        if (lbl) stops.push({ id: v.id, kind: 'v', title: v.clientName, label: Number(lbl) })
      })
      stops.sort((a, b) => a.label - b.label)
      map[c.email] = stops
    })
    return map
  }, [activeDrivers, orderMarkers, visitasDelDia, routeLabels])

  // Reordenar a mano la lista de paradas de un chofer — persiste en el mismo
  // `despachos.orderIds` que usa la pestaña Despacho (no-op silencioso si
  // todavía no existe despacho para ese chofer/día, ver `updateDespacho`).
  const handleManualReorder = useCallback(async (driverEmail: string, stops: { id: string; kind: 'o' | 'v' }[]) => {
    const labels: Record<string, string> = {}
    stops.forEach((s, i) => { labels[s.id] = String(i + 1) })
    setRouteLabels((prev) => ({ ...prev, ...labels }))
    setRouteArrivals((prev) => {
      const n = { ...prev }
      stops.forEach((s) => delete n[s.id])
      return n
    })
    const orderIds = stops.map((s) => `${s.kind}:${s.id}`)
    await updateDespacho(despachoId(selectedDate, driverEmail), (current) => ({
      orderIds,
      ...(current.status === 'confirmado' ? { modifiedAfterConfirm: true } : {}),
    }))

    // Recalcula la polilínea con el nuevo orden ya mismo — antes se persistía
    // el orden pero el trazado dibujado en el mapa seguía siendo el de antes
    // del reordenamiento hasta el próximo "Recalcular ruta" manual, mostrando
    // pines renumerados sobre una línea que ya no correspondía.
    const orderedStops = stops.flatMap((s): RouteStop[] => {
      if (s.kind === 'o') {
        const m = orderMarkers.find((om) => om.id === s.id)
        return m ? [{ id: m.id, clientId: m.clientId ?? '', lat: m.lat, lng: m.lng, address: m.address }] : []
      }
      const v  = visitasDelDia.find((vv) => vv.id === s.id)
      const cm = v ? clientMarkers.find((c) => c.uid === v.clientId) : undefined
      return v && cm ? [{ id: v.id, clientId: v.clientId, lat: cm.lat, lng: cm.lng, address: cm.address }] : []
    })
    void runRouteCalculation(driverEmail, orderedStops)
  }, [selectedDate, orderMarkers, visitasDelDia, clientMarkers, runRouteCalculation])

  const moveStop = useCallback((driverEmail: string, index: number, dir: -1 | 1) => {
    const stops = driverStops[driverEmail] ?? []
    const newIndex = index + dir
    if (newIndex < 0 || newIndex >= stops.length) return
    const reordered = [...stops]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(newIndex, 0, moved)
    void handleManualReorder(driverEmail, reordered)
  }, [driverStops, handleManualReorder])

  return (
    <div className="flex h-full min-h-0 relative">

      {/* ── Panel lateral — en desktop es fijo; en mobile es un drawer que
          se abre sobre el mapa, porque a ese ancho no entran los dos ── */}
      <div className={`${sidebarOpen ? 'flex' : 'hidden'} md:flex flex-col overflow-y-auto bg-white border-r border-[#D3D1C7] absolute md:relative inset-0 z-20 md:z-auto w-full md:w-72 md:flex-shrink-0`}>

        {/* Cabecera del drawer — solo mobile */}
        <div className="flex md:hidden items-center justify-between p-3 border-b border-[#D3D1C7] shrink-0">
          <p className="text-sm font-semibold text-gray-900">Filtros y visitas</p>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Selector de día */}
        <div className="p-3 border-b border-[#D3D1C7]">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {weekDays.map((d, i) => {
              const str        = dateToStr(d)
              const label      = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : d.toLocaleDateString('es-AR', { weekday: 'short' })
              const sublabel   = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
              const count      = orders.filter((o) => orderDateStr(o) === str && !['entregado', 'cancelado'].includes(o.status)).length
              const visCount   = visitasParaFecha(visitas, new Date(str + 'T12:00:00')).length
              const isSelected = str === selectedDate
              return (
                <button
                  key={str}
                  onClick={() => { setSelectedDate(str); setSelectedOrder(null); setSelectedClientId(null) }}
                  className={`flex-shrink-0 flex flex-col items-center px-2 py-1.5 rounded-xl border transition-colors min-w-[58px] ${
                    isSelected
                      ? 'bg-accent text-white border-accent shadow-sm'
                      : 'bg-white border-[#D3D1C7] text-gray-700 hover:border-accent/50'
                  }`}
                >
                  <span className="text-xs font-semibold">{label}</span>
                  <span className={`text-[10px] mt-0.5 ${isSelected ? 'text-white/70' : 'text-gray-400'}`}>{sublabel}</span>
                  {count > 0 && (
                    <span className={`mt-0.5 text-[10px] font-bold ${isSelected ? 'text-white' : 'text-accent'}`}>{count} ped.</span>
                  )}
                  {visCount > 0 && (
                    <span className={`text-[10px] font-medium ${isSelected ? 'text-green-200' : 'text-green-600'}`}>{visCount} vis.</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Leyenda + toggle */}
        <div className="p-3 border-b border-[#D3D1C7] space-y-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {activeDrivers.map((c) => (
              <span key={c.uid} className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: driverColor(c.email, choferes) }} />
                {c.nombreContacto || c.nombre}
              </span>
            ))}
            {ordersDay.some((o) => !o.driverId) && (
              <span className="flex items-center gap-1.5 text-xs text-amber-600">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                Sin asignar
              </span>
            )}
            {showAllClients && clientMarkers.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-gray-400">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-300 shrink-0" />
                Sin pedido ({clientMarkers.length})
              </span>
            )}
            {geocoding && (
              <span className="text-xs text-gray-400 animate-pulse">Geocodificando…</span>
            )}
          </div>
          <button
            onClick={() => setShowAllClients((v) => !v)}
            className={`w-full text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              showAllClients
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-white border-[#D3D1C7] text-gray-500 hover:border-accent'
            }`}
          >
            {showAllClients ? 'Ocultar clientes sin pedido' : 'Mostrar clientes sin pedido'}
          </button>
          {ocultosMapa.size > 0 && (
            <button
              onClick={() => { if (staffUser) restoreClientesOcultosMapa(staffUser.uid) }}
              className="w-full text-xs text-gray-400 hover:text-accent transition-colors"
            >
              {ocultosMapa.size} oculto{ocultosMapa.size !== 1 ? 's' : ''} por vos · Mostrar de nuevo
            </button>
          )}
        </div>

        {/* Zonas prohibidas */}
        <div className="p-3 border-b border-[#D3D1C7] space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Zonas prohibidas</p>
            {!drawingMode && (
              <button
                onClick={() => setDrawingMode(true)}
                className="text-xs text-red-500 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50 transition-colors"
              >+ Añadir</button>
            )}
          </div>

          {zonas.length === 0 && !drawingMode && (
            <p className="text-xs text-gray-400">Sin zonas definidas</p>
          )}

          {zonas.map((z) => (
            <div key={z.id} className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer min-w-0">
                <input
                  type="checkbox"
                  checked={z.activa}
                  className="accent-red-500"
                  onChange={() => saveZonas(zonas.map((x) => x.id === z.id ? { ...x, activa: !x.activa } : x))}
                />
                <span className="truncate text-gray-700">{z.nombre}</span>
              </label>
              <button
                onClick={() => { if (window.confirm(`¿Eliminar "${z.nombre}"?`)) saveZonas(zonas.filter((x) => x.id !== z.id)) }}
                className="text-xs text-gray-400 hover:text-red-500 shrink-0 transition-colors"
              >✕</button>
            </div>
          ))}

          {drawingMode && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2 space-y-2">
              <p className="text-xs text-red-700 font-medium">
                {drawingVertices.length < 3
                  ? `Hacé clic en el mapa para definir vértices. (${drawingVertices.length}/3 mín.)`
                  : `${drawingVertices.length} vértices. Podés seguir o confirmar.`}
              </p>
              {drawingVertices.length >= 3 && (
                <input
                  value={newZonaNombre}
                  onChange={(e) => setNewZonaNombre(e.target.value)}
                  placeholder="Nombre (ej: Av. de la Rivera)"
                  className="w-full text-xs border border-[#D3D1C7] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-red-400"
                />
              )}
              <div className="flex gap-2">
                {drawingVertices.length >= 3 && (
                  <button
                    disabled={!newZonaNombre.trim() || zonaSaving}
                    onClick={async () => {
                      if (!newZonaNombre.trim()) return
                      setZonaSaving(true)
                      try {
                        const nueva: ZonaProhibida = {
                          id:      Date.now().toString(),
                          nombre:  newZonaNombre.trim(),
                          activa:  true,
                          polygon: drawingVertices,
                        }
                        await saveZonas([...zonas, nueva])
                        setDrawingMode(false)
                        setDrawingVertices([])
                        setNewZonaNombre('')
                      } finally {
                        setZonaSaving(false)
                      }
                    }}
                    className="flex-1 text-xs bg-red-500 text-white rounded-lg px-2 py-1.5 disabled:opacity-50 hover:bg-red-600 transition-colors"
                  >
                    {zonaSaving ? 'Guardando…' : 'Confirmar zona'}
                  </button>
                )}
                <button
                  onClick={() => { setDrawingMode(false); setDrawingVertices([]) }}
                  className="text-xs border border-[#D3D1C7] rounded-lg px-2 py-1.5 text-gray-500 hover:text-gray-700 transition-colors"
                >Cancelar</button>
              </div>
              {drawingVertices.length > 0 && (
                <button
                  onClick={() => setDrawingVertices((v) => v.slice(0, -1))}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >← Deshacer último punto</button>
              )}
            </div>
          )}
        </div>

        {/* Rutas del día */}
        {activeDrivers.length > 0 && isLoaded && (
          <div className="p-3 border-b border-[#D3D1C7] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rutas del día</p>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
                <span>Serv.</span>
                <input
                  type="number" min={5} max={120} value={tiempoServicio}
                  onChange={(e) => setTiempoServicio(Number(e.target.value))}
                  className="w-12 border border-[#D3D1C7] rounded-lg px-1.5 py-1 bg-white text-xs text-center focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <span>min</span>
              </label>
            </div>
            {activeDrivers.map((c) => {
              const color       = driverColor(c.email, choferes)
              const plantaId    = plantaChofer[c.email] ?? 'torcuato'
              const calculating = routeCalculating[c.email]
              const hasRoute    = orderMarkers.some((m) => m.driver === c.email && routeLabels[m.id]) ||
                                  visitasDelDia.some((v) => v.driverId === c.email && routeLabels[v.id])
              const unassigned  = routeUnassigned[c.email] ?? []
              const despacho    = despachoByDriver[c.email]
              const hasSavedOrder = (despacho?.orderIds?.length ?? 0) > 0
              const stops       = driverStops[c.email] ?? []
              return (
                <div key={c.uid} className="space-y-1.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    {c.nombreContacto || c.nombre}
                  </span>
                  <div className="flex gap-2 items-center">
                    <label className="text-xs text-gray-500 shrink-0">Salida</label>
                    <input
                      type="time"
                      value={horasSalida[c.email] ?? '07:00'}
                      onChange={(e) => setHorasSalida((prev) => ({ ...prev, [c.email]: e.target.value }))}
                      className="flex-1 text-xs border border-[#D3D1C7] rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <select
                    value={plantaId}
                    onChange={(e) => setPlantaChofer((prev) => ({ ...prev, [c.email]: e.target.value as PlantaId }))}
                    className="w-full text-xs border border-[#D3D1C7] rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {(Object.entries(PLANTAS) as [PlantaId, typeof PLANTAS[PlantaId]][]).map(([id, p]) => (
                      <option key={id} value={id}>{p.label}</option>
                    ))}
                  </select>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => calculateRoute(c.email)}
                      disabled={calculating}
                      className="flex-1 text-xs px-3 py-1.5 rounded-lg border transition-colors bg-accent text-white border-accent hover:bg-accent/90 disabled:opacity-50"
                    >
                      {calculating ? 'Calculando…' : hasRoute ? '↺ Recalcular' : 'Calcular ruta'}
                    </button>
                    {hasRoute && !calculating && (
                      <button
                        onClick={() => clearRoute(c.email)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-[#D3D1C7] text-gray-500 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Limpiar ruta del mapa"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {hasRoute && !calculating && (
                    <p className="text-xs text-green-600 font-medium text-center">
                      {hasSavedOrder ? '✓ Orden guardado (Despacho)' : '✓ Ruta optimizada'}
                    </p>
                  )}
                  {hasSavedOrder && !calculating && (
                    <button
                      onClick={() => calculateRoute(c.email, true)}
                      className="w-full flex items-center justify-center gap-1 text-[10px] text-gray-400 hover:text-accent transition-colors"
                    >
                      <RotateCcw size={10} /> Recalcular automático (descarta el orden guardado)
                    </button>
                  )}
                  {stops.length > 0 && !calculating && (
                    <div className="border border-[#D3D1C7] rounded-lg divide-y divide-[#E4E1D6] overflow-hidden">
                      {stops.map((s, i) => (
                        <div key={s.id} className="flex items-center gap-1.5 pl-1.5 pr-1 py-1 bg-white">
                          <span className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                            style={{ backgroundColor: color }}>
                            {i + 1}
                          </span>
                          <p className="text-xs text-gray-700 truncate flex-1 min-w-0">{s.title}</p>
                          <div className="flex shrink-0">
                            <button
                              onClick={() => moveStop(c.email, i, -1)}
                              disabled={i === 0 || !despacho}
                              title={!despacho ? 'Confirmá el despacho en la pestaña Despacho para poder reordenar acá' : 'Subir'}
                              className="p-0.5 rounded text-gray-300 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                            >
                              <ChevronUp size={12} />
                            </button>
                            <button
                              onClick={() => moveStop(c.email, i, 1)}
                              disabled={i === stops.length - 1 || !despacho}
                              title={!despacho ? 'Confirmá el despacho en la pestaña Despacho para poder reordenar acá' : 'Bajar'}
                              className="p-0.5 rounded text-gray-300 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                            >
                              <ChevronDown size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {unassigned.length > 0 && !calculating && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 space-y-0.5">
                      <p className="text-xs text-amber-700 font-medium">⚠ {unassigned.length} parada(s) fuera de horario</p>
                      {unassigned.map((stopId) => {
                        const ord = orderMarkers.find((m) => m.id === stopId)
                        const vis = visitasDelDia.find((v) => v.id === stopId)
                        return <p key={stopId} className="text-[10px] text-amber-600 truncate">· {ord?.title ?? vis?.clientName ?? stopId}</p>
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Visitas agendadas */}
        {visitasDelDia.length > 0 && (
          <div className="p-3 space-y-2.5">
            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">
              Visitas agendadas · {visitasDelDia.length}
            </p>
            {visitasDelDia.map((v) => {
              const chofer = choferes.find((c) => c.email === v.driverId)
              return (
                <div key={v.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-gray-900 leading-snug">{v.clientName}</p>
                      {routeArrivals[v.id] && (
                        <span className="text-[10px] text-accent font-semibold shrink-0">⏱ {routeArrivals[v.id]}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 truncate">{v.clientAddress}</p>
                    {chofer && (
                      <p className="text-[10px] text-gray-400">
                        <span className="text-gray-600">{chofer.nombreContacto || chofer.nombre || chofer.email}</span>
                      </p>
                    )}
                    {v.status === 'visitado'     && <span className="text-[10px] text-green-600 font-medium">✓ Visitado</span>}
                    {v.status === 'sin_contacto' && <span className="text-[10px] text-amber-600 font-medium">Sin contacto</span>}
                  </div>
                  <button
                    onClick={() => deleteVisitaPuntual(v.id)}
                    className="text-xs text-gray-400 hover:text-red-500 border border-[#D3D1C7] hover:border-red-300 rounded-lg px-1.5 py-0.5 transition-colors shrink-0"
                  >✕</button>
                </div>
              )
            })}
          </div>
        )}

        {/* Empty state */}
        {isLoaded && orderMarkers.length === 0 && visitasDelDia.length === 0 && !geocoding && (
          <p className="text-center text-xs text-gray-400 p-4">
            Sin pedidos ni visitas para este día
          </p>
        )}
      </div>

      {/* ── Mapa ── */}
      <div className="flex-1 relative">
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-white border border-[#D3D1C7] rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 shadow-md"
        >
          <SlidersHorizontal size={13} /> Filtros
        </button>
        {drawingMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-orange-500 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg pointer-events-none">
            Modo dibujo — clic para agregar vértices
          </div>
        )}
        {!isLoaded ? (
          <div className="w-full h-full bg-gray-100 animate-pulse" />
        ) : (
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={{ lat: -34.6037, lng: -58.3816 }}
            zoom={12}
            options={{
              disableDefaultUI:       true,
              zoomControl:            true,
              gestureHandling:        'greedy',
              mapTypeControl:         false,
              styles:                 MAP_STYLES,
              draggableCursor:        drawingMode ? 'crosshair' : undefined,
              draggingCursor:         drawingMode ? 'crosshair' : undefined,
            }}
            onLoad={(m) => { mapRef.current = m }}
            onClick={(e) => {
              if (drawingMode) {
                if (e.latLng) setDrawingVertices((prev) => [...prev, { lat: e.latLng!.lat(), lng: e.latLng!.lng() }])
                return
              }
              setSelectedOrder(null)
            }}
          >
            {/* Pines de clientes sin pedido — con el toggle apagado, `clientMarkers`
                ya viene acotado (por el efecto de geocodificación) a solo los
                clientes con visita agendada hoy, así que no hace falta
                repetir el gate acá: siempre se muestra lo que haya. */}
            {clientMarkers.map((m) => {
              const visitaExistente = visitasDelDia.find((v) => v.clientId === m.uid)
              const visitaLabel = visitaExistente ? routeLabels[visitaExistente.id] : undefined
              const pinColor = visitaExistente?.driverId
                ? driverColor(visitaExistente.driverId, choferes)
                : visitaExistente
                  ? '#1D9E75'
                  : undefined
              return (
              <Marker
                key={`c-${m.id}`}
                position={{ lat: m.lat, lng: m.lng }}
                icon={visitaLabel && pinColor
                  ? makeOrderPin(pinColor, visitaLabel)
                  : makeClientPin(pinColor)
                }
                zIndex={1}
                onClick={() => { setSelectedClientId((s) => s === m.id ? null : m.id); setVisitaDriverId(null) }}
              >
                {selectedClientId === m.id && (
                  <InfoWindow onCloseClick={() => { setSelectedClientId(null); setVisitaDriverId(null) }}>
                    <div style={{ fontSize: 13, minWidth: 200, lineHeight: 1.5, fontFamily: 'sans-serif', color: '#111' }}>
                      <p style={{ margin: '0 0 2px', fontWeight: 700 }}>{m.title}</p>
                      <p style={{ margin: '0 0 2px', color: '#666', fontSize: 11 }}>{m.address}</p>
                      {m.phone && <p style={{ margin: '0 0 6px', color: '#1D9E75', fontSize: 11 }}>{m.phone}</p>}
                      {!visitaExistente && staffUser && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setClienteOcultoMapa(staffUser.uid, m.uid, true)
                            setSelectedClientId(null)
                          }}
                          style={{ display: 'block', margin: '0 0 10px', padding: 0, background: 'none', border: 'none', color: '#999', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
                        >
                          No mostrar de nuevo en mi mapa
                        </button>
                      )}
                      {visitaDone.has(m.id) || visitaDone.has(m.uid) || visitaExistente ? (
                        <p style={{ color: '#1D9E75', fontWeight: 700, margin: 0 }}>✓ Visita agendada</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <p style={{ margin: 0, fontWeight: 600, fontSize: 12 }}>
                            Agendar visita · {new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </p>
                          <select
                            value={visitaDriverId ?? ''}
                            onChange={(e) => setVisitaDriverId(e.target.value || null)}
                            style={{ width: '100%', padding: '5px 8px', border: '1px solid #ccc', borderRadius: 6, fontSize: 12, background: '#fff', color: '#111', cursor: 'pointer' }}
                          >
                            <option value="">— Sin asignar —</option>
                            {choferes.map((c) => (
                              <option key={c.uid} value={c.email}>{c.nombreContacto || c.nombre || c.email}</option>
                            ))}
                          </select>
                          <button
                            disabled={visitaSaving}
                            onClick={async (e) => {
                              e.stopPropagation()
                              setVisitaSaving(true)
                              try {
                                await addVisitaPuntual({
                                  clientId:      m.uid,
                                  clientName:    m.title,
                                  clientAddress: m.address,
                                  clientPhone:   m.phone,
                                  fecha:         Timestamp.fromDate(new Date(selectedDate + 'T12:00:00')),
                                  driverId:      visitaDriverId,
                                  status:        'pendiente',
                                })
                                setVisitaDone((prev) => new Set(prev).add(m.id))
                                setTimeout(() => { setSelectedClientId(null); setVisitaDriverId(null) }, 1800)
                              } catch (err) {
                                console.error('Error al guardar visita:', err)
                              } finally {
                                setVisitaSaving(false)
                              }
                            }}
                            style={{ display: 'block', width: '100%', padding: '7px 10px', background: visitaSaving ? '#aaa' : '#1D9E75', color: '#fff', border: 'none', borderRadius: 8, cursor: visitaSaving ? 'default' : 'pointer', fontSize: 12, fontWeight: 700 }}
                          >
                            {visitaSaving ? 'Guardando…' : 'Agendar visita'}
                          </button>
                        </div>
                      )}
                    </div>
                  </InfoWindow>
                )}
              </Marker>
              )
            })}

            {/* Pines de color: pedidos del día */}
            {orderMarkers.map((m) => (
              <Marker
                key={`o-${m.id}`}
                position={{ lat: m.lat, lng: m.lng }}
                icon={makeOrderPin(m.color, routeLabels[m.id] ?? m.label)}
                zIndex={10}
                onClick={() => setSelectedOrder((s) => s === m.id ? null : m.id)}
              >
                {selectedOrder === m.id && (
                  <InfoWindow onCloseClick={() => setSelectedOrder(null)}>
                    <div style={{ fontSize: 13, minWidth: 150, lineHeight: 1.5 }}>
                      <p style={{ fontWeight: 700, margin: '0 0 2px', color: '#111' }}>{m.title}</p>
                      <p style={{ margin: 0, color: '#555' }}>{m.subtitle}</p>
                      {m.driver && (() => {
                        const ch = choferes.find((c) => c.email === m.driver)
                        return ch ? (
                          <p style={{ margin: '3px 0 0', color: m.color, fontWeight: 600, fontSize: 11 }}>
                            ● {ch.nombreContacto || ch.nombre}
                          </p>
                        ) : null
                      })()}
                    </div>
                  </InfoWindow>
                )}
              </Marker>
            ))}

            {/* Polilíneas de rutas calculadas */}
            {Object.entries(routePaths).map(([email, path]) => (
              <Polyline
                key={email}
                path={path}
                options={{
                  strokeColor:   driverColor(email, choferes),
                  strokeWeight:  5,
                  strokeOpacity: 0.88,
                }}
              />
            ))}

            {/* Polígonos de zonas prohibidas */}
            {zonas.filter((z) => z.activa && z.polygon.length >= 3).map((z) => (
              <Polygon
                key={z.id}
                paths={z.polygon}
                options={{
                  fillColor:     '#EF4444',
                  fillOpacity:   0.18,
                  strokeColor:   '#EF4444',
                  strokeWeight:  2,
                  strokeOpacity: 0.8,
                }}
              />
            ))}

            {/* Preview del polígono en dibujo */}
            {drawingMode && drawingVertices.length >= 2 && (
              <Polygon
                paths={drawingVertices}
                options={{
                  fillColor:     '#F97316',
                  fillOpacity:   0.15,
                  strokeColor:   '#F97316',
                  strokeWeight:  2,
                  strokeOpacity: 0.9,
                }}
              />
            )}
            {drawingMode && drawingVertices.map((v, i) => (
              <Marker
                key={`dv-${i}`}
                position={v}
                icon={{
                  path:          google.maps.SymbolPath.CIRCLE,
                  scale:         6,
                  fillColor:     '#F97316',
                  fillOpacity:   1,
                  strokeColor:   '#fff',
                  strokeWeight:  2,
                }}
              />
            ))}
          </GoogleMap>
        )}
      </div>

    </div>
  )
}
