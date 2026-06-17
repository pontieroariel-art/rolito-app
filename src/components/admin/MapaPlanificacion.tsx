import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Timestamp } from 'firebase/firestore'
import { GoogleMap, Marker, InfoWindow, Polyline, Polygon } from '@react-google-maps/api'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { summarizeProducts } from '../../utils/helpers'
import { addVisitaPuntual, deleteVisitaPuntual } from '../../services/visitasService'
import { useVisitasPuntuales, visitasParaFecha } from '../../hooks/useVisitas'
import { useZonasProhibidas } from '../../hooks/useZonas'
import { saveZonas, ZonaProhibida } from '../../services/zonasService'
import { Order, UserProfile, getPrimaryAddress, PLANTAS, PlantaId } from '../../types'

// ── Constantes ────────────────────────────────────────────────────────────────

const DRIVER_COLORS = ['#00C2FF', '#FF6B6B', '#4ECDC4', '#A8E6CF', '#FFE66D', '#C084FC', '#F97316', '#34D399']

const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: 'poi',               stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',           stylers: [{ visibility: 'off' }] },
  { featureType: 'road',              elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative',    elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
]

// Cache de geocodificación a nivel de módulo — persiste entre montajes
const GEO_CACHE = new Map<string, { lat: number; lng: number } | null>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateToStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function orderDateStr(o: Order): string {
  if (!o.date?.toDate) return ''
  return dateToStr(o.date.toDate())
}

function driverColor(email: string, choferes: UserProfile[]): string {
  const idx = choferes.findIndex((c) => c.email === email)
  return idx >= 0 ? DRIVER_COLORS[idx % DRIVER_COLORS.length] : '#F59E0B'
}


function timeStrToUnix(date: string, time: string): number {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return 0
  return Math.floor(new Date(`${date}T${time.padStart(5, '0')}:00`).getTime() / 1000)
}

function unixToTimeStr(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
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
  const mapRef             = useRef<google.maps.Map | null>(null)

  const [selectedDate,      setSelectedDate]      = useState(() => dateToStr(new Date()))
  const [orderMarkers,      setOrderMarkers]      = useState<OrderMarker[]>([])
  const [clientMarkers,     setClientMarkers]     = useState<ClientMarker[]>([])
  const [geocoding,         setGeocoding]         = useState(false)
  const [showAllClients,    setShowAllClients]    = useState(true)
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

  // Resetear rutas al cambiar de día
  useEffect(() => {
    setRouteLabels({})
    setRoutePaths({})
    setRouteArrivals({})
    setRouteUnassigned({})
  }, [selectedDate])

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
        } as OrderMarker
      }),
    ).then((res) => {
      setOrderMarkers(res.filter(Boolean) as OrderMarker[])
      setGeocoding(false)
    })
  }, [isLoaded, ordersDay, choferes, geocode])

  // Geocodificar sucursales sin pedido (usa coords guardadas primero)
  useEffect(() => {
    if (!isLoaded || allClients.length === 0) return
    Promise.all(
      clientsWithoutOrder.map(async (s) => {
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
  }, [isLoaded, clientsWithoutOrder, geocode])

  // Visitas puntuales del día seleccionado (de Firestore en tiempo real)
  const visitasDelDia = useMemo(
    () => visitasParaFecha(visitas, new Date(selectedDate + 'T12:00:00')),
    [visitas, selectedDate],
  )

  // Calcular ruta: ORS Optimization (time windows) → ORS Directions (avoid_polygons)
  const calculateRoute = useCallback((driverEmail: string) => {
    const plantaId = plantaChofer[driverEmail] ?? 'torcuato'
    const planta   = PLANTAS[plantaId]

    const orderWps = orderMarkers.filter((m) => m.driver === driverEmail)
    const visitWps = visitasDelDia
      .filter((v) => v.driverId === driverEmail)
      .flatMap((v) => {
        const cm = clientMarkers.find((c) => c.uid === v.clientId)
        return cm ? [{ id: v.clientId, clientId: v.clientId, lat: cm.lat, lng: cm.lng }] : []
      })
    const all: { id: string; clientId: string; lat: number; lng: number }[] = [
      ...orderWps.map((m) => ({ id: m.id, clientId: m.clientId ?? '', lat: m.lat, lng: m.lng })),
      ...visitWps,
    ]
    if (all.length === 0 || !isLoaded) return

    setRouteCalculating((prev) => ({ ...prev, [driverEmail]: true }))

    void (async () => {
      try {
        const orsKey         = import.meta.env.VITE_ORS_KEY
        const departureTime  = horasSalida[driverEmail] ?? '07:00'
        const vehicleStart   = timeStrToUnix(selectedDate, departureTime)
        const vehicleEnd     = timeStrToUnix(selectedDate, '22:00')
        const serviceSeconds = tiempoServicio * 60

        // Paso 1: ORS Optimization — orden respetando horarios de clientes
        const jobs = all.map((stop, idx) => {
          const client = allClients.find((c) => c.uid === stop.clientId)
          const addr   = client ? getPrimaryAddress(client) : null
          const open   = addr?.horarioApertura ? timeStrToUnix(selectedDate, addr.horarioApertura) : 0
          const close  = addr?.horarioCierre   ? timeStrToUnix(selectedDate, addr.horarioCierre)   : vehicleEnd
          const job: Record<string, unknown> = {
            id:       idx + 1,
            location: [stop.lng, stop.lat],
            service:  serviceSeconds,
          }
          if (open && close && close > open) job.time_windows = [[open, close]]
          return job
        })

        const optRes  = await fetch('https://api.openrouteservice.org/v2/optimization', {
          method:  'POST',
          headers: { 'Authorization': orsKey, 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            jobs,
            vehicles: [{
              id:          1,
              profile:     'driving-hgv',
              start:       [planta.lng, planta.lat],
              end:         [planta.lng, planta.lat],
              time_window: [vehicleStart, vehicleEnd],
            }],
          }),
        })
        const optData = await optRes.json()
        if (!optData.routes?.[0]) throw new Error(optData.error?.message ?? 'Sin solución ORS Opt.')

        // Extraer orden y llegadas estimadas
        const steps = (optData.routes[0].steps as { type: string; id?: number; arrival: number }[])
          .filter((s) => s.type === 'job')
        const orderedStops = steps.map((s) => all[s.id! - 1])

        const labels:   Record<string, string> = {}
        const arrivals: Record<string, string> = {}
        steps.forEach((s, routeIdx) => {
          const stop = all[s.id! - 1]
          labels[stop.id]   = String(routeIdx + 1)
          arrivals[stop.id] = unixToTimeStr(s.arrival)
        })
        setRouteLabels((prev)   => ({ ...prev, ...labels   }))
        setRouteArrivals((prev) => ({ ...prev, ...arrivals }))

        const unassigned = ((optData.unassigned ?? []) as { id: number }[])
          .map((u) => all[u.id - 1]?.id).filter(Boolean) as string[]
        setRouteUnassigned((prev) => ({ ...prev, [driverEmail]: unassigned }))

        // Paso 2: ORS Directions — camino real con avoid_polygons
        const coordinates = [planta, ...orderedStops, planta].map((p) => [p.lng, p.lat])
        const zonasActivas = zonas.filter((z) => z.activa && z.polygon.length >= 3)
        const dirBody: Record<string, unknown> = { coordinates }
        if (zonasActivas.length > 0) {
          dirBody.options = {
            avoid_polygons: {
              type: 'MultiPolygon',
              coordinates: zonasActivas.map((z) => {
                const ring = z.polygon.map((p) => [p.lng, p.lat])
                return [[...ring, ring[0]]]
              }),
            },
          }
        }

        const dirRes  = await fetch('https://api.openrouteservice.org/v2/directions/driving-hgv/geojson', {
          method:  'POST',
          headers: { 'Authorization': orsKey, 'Content-Type': 'application/json' },
          body:    JSON.stringify(dirBody),
        })
        const dirData = await dirRes.json()

        if (dirData.features?.[0]?.geometry?.coordinates) {
          const path = (dirData.features[0].geometry.coordinates as [number, number][])
            .map(([lng, lat]) => ({ lat, lng }))
          setRoutePaths((prev) => ({ ...prev, [driverEmail]: path }))
        } else {
          throw new Error(dirData.error?.message ?? 'Sin ruta ORS Dir.')
        }

        setRouteCalculating((prev) => ({ ...prev, [driverEmail]: false }))
      } catch (err) {
        console.warn('ORS falló, fallback a Google Maps:', err)
        const origin = new google.maps.LatLng(planta.lat, planta.lng)
        new google.maps.DirectionsService().route(
          {
            origin,
            destination:       origin,
            waypoints:         all.map((w) => ({ location: new google.maps.LatLng(w.lat, w.lng), stopover: true })),
            optimizeWaypoints: true,
            travelMode:        google.maps.TravelMode.DRIVING,
          },
          (result, status) => {
            if (status === 'OK' && result) {
              const order = result.routes[0].waypoint_order
              const labels: Record<string, string> = {}
              order.forEach((wIdx, idx) => { labels[all[wIdx].id] = String(idx + 1) })
              setRouteLabels((prev) => ({ ...prev, ...labels }))
              const path = result.routes[0].overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }))
              setRoutePaths((prev) => ({ ...prev, [driverEmail]: path }))
            }
            setRouteCalculating((prev) => ({ ...prev, [driverEmail]: false }))
          },
        )
      }
    })()
  }, [plantaChofer, orderMarkers, visitasDelDia, clientMarkers, isLoaded, zonas, horasSalida, tiempoServicio, allClients, selectedDate])

  // Auto-fit bounds
  useEffect(() => {
    if (!mapRef.current) return
    const pts = [
      ...orderMarkers,
      ...(showAllClients
        ? clientMarkers
        : clientMarkers.filter((m) => visitasDelDia.some((v) => v.clientId === m.id))
      ),
    ]
    if (pts.length === 0) return
    if (pts.length === 1) { mapRef.current.panTo(pts[0]); mapRef.current.setZoom(14); return }
    const bounds = new google.maps.LatLngBounds()
    pts.forEach((p) => bounds.extend(p))
    mapRef.current.fitBounds(bounds, 60)
  }, [orderMarkers, clientMarkers, showAllClients])

  // Choferes activos en el día (con pedidos O con visitas agendadas)
  const activeDrivers = choferes.filter((c) =>
    ordersDay.some((o) => o.driverId === c.email) ||
    visitasDelDia.some((v) => v.driverId === c.email),
  )

  return (
    <div className="flex h-full min-h-0">

      {/* ── Panel lateral ── */}
      <div className="w-72 flex-shrink-0 flex flex-col overflow-y-auto bg-white border-r border-[#D3D1C7]">

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
            {showAllClients ? 'Ocultar clientes sin pedido' : 'Ver todos los clientes'}
          </button>
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
                                  visitasDelDia.some((v) => v.driverId === c.email && routeLabels[v.clientId])
              const unassigned  = routeUnassigned[c.email] ?? []
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
                  <button
                    onClick={() => calculateRoute(c.email)}
                    disabled={calculating}
                    className="w-full text-xs px-3 py-1.5 rounded-lg border transition-colors bg-accent text-white border-accent hover:bg-accent/90 disabled:opacity-50"
                  >
                    {calculating ? 'Calculando…' : hasRoute ? '↺ Recalcular ruta' : 'Calcular ruta'}
                  </button>
                  {hasRoute && !calculating && (
                    <p className="text-xs text-green-600 font-medium text-center">✓ Ruta optimizada</p>
                  )}
                  {unassigned.length > 0 && !calculating && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 space-y-0.5">
                      <p className="text-xs text-amber-700 font-medium">⚠ {unassigned.length} parada(s) fuera de horario</p>
                      {unassigned.map((stopId) => {
                        const ord = orderMarkers.find((m) => m.id === stopId)
                        const vis = visitasDelDia.find((v) => v.clientId === stopId)
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
                      {routeArrivals[v.clientId] && (
                        <span className="text-[10px] text-accent font-semibold shrink-0">⏱ {routeArrivals[v.clientId]}</span>
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
            {/* Pines de clientes sin pedido */}
            {clientMarkers
              .filter((m) => showAllClients || visitasDelDia.some((v) => v.clientId === m.uid))
              .map((m) => {
              const visitaExistente = visitasDelDia.find((v) => v.clientId === m.uid)
              const pinColor = visitaExistente?.driverId
                ? driverColor(visitaExistente.driverId, choferes)
                : visitaExistente
                  ? '#1D9E75'
                  : undefined
              return (
              <Marker
                key={`c-${m.id}`}
                position={{ lat: m.lat, lng: m.lng }}
                icon={routeLabels[m.id] && pinColor
                  ? makeOrderPin(pinColor, routeLabels[m.id])
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
                      {m.phone && <p style={{ margin: '0 0 10px', color: '#1D9E75', fontSize: 11 }}>{m.phone}</p>}
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
                  strokeWeight:  4,
                  strokeOpacity: 0.65,
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
