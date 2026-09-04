import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { GoogleMap, DirectionsRenderer, Marker } from '@react-google-maps/api'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  MouseSensor, TouchSensor, useSensor, useSensors,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import ChoferHeader from '../../components/chofer/ChoferHeader'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useDriverOrders } from '../../hooks/useOrders'
import { updateDriverLocation, deactivateDriverLocation } from '../../services/locationService'
import { subscribeDespachosForDriver, subscribeDespachosForAyudante, pickActiveDespacho, todayStr, ordenarPorRutaDespacho } from '../../services/despachoService'
import { useAuth } from '../../context/AuthContext'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { summarizeProducts } from '../../utils/helpers'
import { generateHojaDeRuta } from '../../utils/pdf'
import type { Despacho, Order } from '../../types'
import { PLANTAS } from '../../types'
import { reportError } from '@/services/observability'

const BA_CENTER = { lat: -34.6037, lng: -58.3816 }

// ── SortableStop ──────────────────────────────────────────────────────────────

function SortableStop({ order, index }: { order: Order; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: order.id })
  const totalUnits = order.products.reduce((s, p) => s + p.quantity, 0)

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      className={`flex justify-between items-center px-4 py-3 border-b border-[#D3D1C7]/60 last:border-0 gap-3 ${isDragging ? 'bg-[#F1EFE8]' : ''}`}
    >
      {/* Handle de arrastre + número */}
      <div
        {...listeners} {...attributes}
        className="flex items-center gap-3 cursor-grab active:cursor-grabbing touch-none shrink-0"
        style={{ touchAction: 'none' }}
      >
        <div className="flex flex-col gap-0.5 text-gray-300 hover:text-gray-500 transition-colors px-0.5">
          <span className="block w-3.5 h-0.5 bg-current rounded-full" />
          <span className="block w-3.5 h-0.5 bg-current rounded-full" />
          <span className="block w-3.5 h-0.5 bg-current rounded-full" />
        </div>
        <span className="w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold bg-accent/20 text-accent">
          {index + 1}
        </span>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">{order.clientName}</p>
        <p className="text-xs text-gray-500 truncate">{order.clientAddress}</p>
      </div>

      {/* Cantidad pedida (las acciones de entrega viven en la pestaña Entregas) */}
      <div className="shrink-0 text-right max-w-[45%]">
        <p className="text-base font-bold text-gray-900 tabular-nums leading-none">{totalUnits}<span className="text-xs font-medium text-gray-400"> u</span></p>
        <p className="text-[11px] text-gray-400 truncate">{summarizeProducts(order.products)}</p>
      </div>
    </div>
  )
}

const MAP_CONTAINER_STYLE: React.CSSProperties = { width: '100%', height: '100%' }

const WARM_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { featureType: 'poi',     stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f5e9c8' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#e0c97a' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#f9f6f0' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f5f2ec' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9e4f0' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#d8ead2' }] },
]

const MAP_OPTIONS: google.maps.MapOptions = {
  styles:            WARM_MAP_STYLE,
  streetViewControl: false,
  mapTypeControl:    false,
  fullscreenControl: true,
  gestureHandling:   'greedy',
}

export default function ChoferMap() {
  const { user }                      = useAuth()
  const { isLoaded, loadError }       = useGoogleMapsLoader()
  const [directions, setDirections]   = useState<google.maps.DirectionsResult | null>(null)
  const [routeError, setRouteError]   = useState('')
  const [calculating, setCalculating] = useState(false)
  const [currentPos, setCurrentPos]   = useState<google.maps.LatLngLiteral | null>(null)
  const [routeStale, setRouteStale]   = useState(false)
  const [pdfLoading, setPdfLoading]   = useState(false)
  const [manualOrder, setManualOrder] = useState<string[]>([])
  const [activeId,    setActiveId]    = useState<string | null>(null)

  const isAyudante = user?.subrol === 'ayudante'
  // Puede haber más de un despacho el mismo día (varias vueltas del mismo
  // chofer) — vienen ordenados por vuelta ascendente.
  const [misDespachos,          setMisDespachos]          = useState<Despacho[]>([])
  const [pairedDespachos,       setPairedDespachos]       = useState<Despacho[]>([])
  const [pairedDespachoLoading, setPairedDespachoLoading] = useState(isAyudante)

  // Suscribirse al despacho: chofer propio o del chofer asignado (ayudante)
  useEffect(() => {
    if (!user?.email || isAyudante) return
    return subscribeDespachosForDriver(todayStr(), user.email, setMisDespachos)
  }, [user?.email, isAyudante])

  useEffect(() => {
    if (!user?.email || !isAyudante) return
    return subscribeDespachosForAyudante(todayStr(), user.email, (ds) => {
      setPairedDespachos(ds)
      setPairedDespachoLoading(false)
    })
  }, [user?.email, isAyudante])

  const despachosHoy = isAyudante ? pairedDespachos : misDespachos
  // El despacho "activo" — el confirmado de vuelta más alta (o el primero si
  // ninguno está confirmado todavía) — solo para el banner de camión/planta.
  const myDespacho = pickActiveDespacho(despachosHoy)

  // Email para cargar pedidos del chofer asignado (ayudante) o propios (chofer)
  const ordersEmail = isAyudante
    ? (pairedDespachoLoading ? null : (pairedDespachos[0]?.driverId ?? null))
    : undefined

  const { orders, loading }           = useDriverOrders(ordersEmail)

  const pending = useMemo(
    () => orders.filter((o) => o.status !== 'entregado' && o.clientAddress),
    [orders],
  )
  // Booleano estable: cambia solo entre "hay pendientes" / "no hay", no en
  // cada entrega marcada — usarlo como dependencia evita que los efectos de
  // abajo (wake lock, envío de GPS) se reinicien en cada entrega individual.
  const hasPending = pending.length > 0

  const hasDespachoOrder = despachosHoy.some((d) => d.status === 'confirmado' && (d.orderIds?.length ?? 0) > 0)

  // Orden base = la ruta que armó logística (despacho.orderIds, concatenando
  // vueltas). Misma lógica que usa la lista de entregas del chofer
  // (ChoferDashboard) vía el helper compartido, para que mapa y lista coincidan.
  const baseOrder = useMemo<Order[]>(
    () => ordenarPorRutaDespacho(pending, despachosHoy),
    [despachosHoy, pending],
  )

  // Inicializar/sincronizar el orden manual cuando cambia el orden base
  const prevBaseIds = useRef<string>('')
  useEffect(() => {
    const baseIds = baseOrder.map((o) => o.id).join(',')
    if (baseIds === prevBaseIds.current) return
    prevBaseIds.current = baseIds
    // Conservar orden manual si ya existe, solo agregar/quitar los nuevos
    setManualOrder((prev) => {
      if (prev.length === 0) return baseOrder.map((o) => o.id)
      const prevSet = new Set(prev)
      const newIds  = baseOrder.map((o) => o.id).filter((id) => !prevSet.has(id))
      return [...prev.filter((id) => baseOrder.some((o) => o.id === id)), ...newIds]
    })
  }, [baseOrder])

  // Aplicar orden manual sobre los pedidos pendientes
  const orderedPending = useMemo<Order[]>(() => {
    const byId = new Map(pending.map((o) => [o.id, o]))
    return manualOrder.map((id) => byId.get(id)).filter((o): o is Order => !!o)
  }, [pending, manualOrder])

  // Posiciones de las paradas (y de la planta) para dibujar marcadores NUMERADOS
  // (Google numera con letras A/B/C por defecto — el chofer quiere números). Se
  // extraen de la ruta ya calculada: la secuencia de puntos es
  // [inicio, fin de cada tramo]; si el primer punto es la planta (hay un punto
  // más que paradas), se separa y las paradas se numeran 1..n en orden de ruta.
  const routeMarkers = useMemo(() => {
    const legs = directions?.routes[0]?.legs ?? []
    if (legs.length === 0) return null
    const points = [legs[0].start_location, ...legs.map((l) => l.end_location)]
    const conPlanta = points.length === orderedPending.length + 1
    return {
      plantaPos: conPlanta ? points[0] : null,
      stops:     conPlanta ? points.slice(1) : points,
    }
  }, [directions, orderedPending.length])

  // DnD sensors
  const sensors = useSensors(
    useSensor(MouseSensor,  { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,  { activationConstraint: { delay: 150, tolerance: 8 } }),
  )

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(active.id as string)

  const handleDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    setActiveId(null)
    if (!over || active.id === over.id) return
    setManualOrder((prev) => {
      const from = prev.indexOf(active.id as string)
      const to   = prev.indexOf(over.id as string)
      if (from === -1 || to === -1) return prev
      const next = arrayMove(prev, from, to)
      return next
    })
    setDirections(null)
    setRouteStale(true)
  }, [])

  const nombreRef   = useRef(user?.nombreContacto || user?.nombre || '')
  const telefonoRef = useRef(user?.telefono       || user?.phone  || '')
  useEffect(() => {
    nombreRef.current   = user?.nombreContacto || user?.nombre || ''
    telefonoRef.current = user?.telefono       || user?.phone  || ''
  })

  // Para evitar race condition en deactivateDriverLocation (ver ChoferDashboard.tsx)
  const gpsEnVueloRef = useRef(false)
  const locationGenRef = useRef(0)
  // Para descartar una respuesta de ruta obsoleta si el usuario toca
  // "Calcular ruta" dos veces antes de que resuelva la primera llamada
  const routeRequestIdRef = useRef(0)

  // Mantener pantalla encendida para que el GPS siga actualizando con pantalla bloqueada
  useEffect(() => {
    if (!hasPending || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    const acquire = () =>
      (navigator as { wakeLock: { request: (t: string) => Promise<WakeLockSentinel> } })
        .wakeLock.request('screen').then((l) => { lock = l }).catch(() => {})
    acquire()
    const onVisible = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [hasPending])

  useEffect(() => {
    // hasPending (no pending.length): antes este efecto se reiniciaba en cada
    // entrega marcada (el cleanup desactivaba la ubicación y recién se
    // reactivaba cuando volvía a resolver getCurrentPosition), así que el
    // chofer "desaparecía" del mapa en vivo después de cada entrega en vez de
    // solo al terminar la ruta.
    if (!hasPending || !user?.email || !navigator.geolocation) return
    const email = user.email
    const gen   = ++locationGenRef.current
    const send  = () =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude })
          // Una posición en vuelo a la vez (ver ChoferDashboard): sin señal no
          // acumular una cola de writes que compita con las ventas al volver.
          if (gpsEnVueloRef.current) return
          gpsEnVueloRef.current = true
          updateDriverLocation(email, pos.coords.latitude, pos.coords.longitude,
            nombreRef.current, telefonoRef.current)
            .catch(() => {})
            .finally(() => { gpsEnVueloRef.current = false })
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      )
    send()
    const id = setInterval(send, 10_000)
    return () => {
      clearInterval(id)
      // Microtask: si un nuevo efecto ya montó (gen cambió), no desactivar
      // (mismo fix que ChoferDashboard.tsx, para evitar la race condition
      // donde una desactivación en vuelo pisa una reactivación posterior).
      Promise.resolve().then(() => {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (locationGenRef.current === gen) {
          deactivateDriverLocation(email).catch((err) => reportError(err, { origen: 'ChoferMap' }))
        }
      })
    }
  }, [hasPending, user?.email])

  const calculateRoute = async () => {
    if (orderedPending.length === 0) return
    const requestId = ++routeRequestIdRef.current
    setCalculating(true)
    setRouteError('')
    setRouteStale(false)

    try {
      const service = new google.maps.DirectionsService()
      const plantaCoords = myDespacho?.plantaId ? PLANTAS[myDespacho.plantaId] : null
      const plantaLatLng = plantaCoords ? { lat: plantaCoords.lat, lng: plantaCoords.lng } : null
      // Siempre salir desde la planta (igual que planificación), no desde GPS actual
      const origin   = plantaLatLng ?? orderedPending[0].clientAddress
      const allStops = plantaLatLng ? orderedPending : orderedPending.slice(1)
      const destination = allStops[allStops.length - 1].clientAddress
      const waypoints   = allStops.slice(0, -1).map((o) => ({
        location: o.clientAddress,
        stopover: true,
      }))

      const result = await service.route({
        origin,
        destination,
        waypoints,
        // Si el orden viene de logística ya está optimizado, no re-optimizar
        optimizeWaypoints: !hasDespachoOrder,
        travelMode:        google.maps.TravelMode.DRIVING,
        region:            'AR',
      })
      if (requestId !== routeRequestIdRef.current) return // respuesta obsoleta, se pidió otro cálculo después
      setDirections(result)
    } catch {
      if (requestId !== routeRequestIdRef.current) return
      setRouteError('No se pudo calcular la ruta. Verificá que las direcciones sean correctas.')
    } finally {
      if (requestId === routeRequestIdRef.current) setCalculating(false)
    }
  }

  const openAllInMaps = () => {
    if (orderedPending.length === 0) return
    const plantaCoords = myDespacho?.plantaId ? PLANTAS[myDespacho.plantaId] : null
    const origin    = plantaCoords
      ? `${plantaCoords.lat},${plantaCoords.lng}`
      : encodeURIComponent(orderedPending[0].clientAddress)
    const addresses = orderedPending.map((o) => encodeURIComponent(o.clientAddress)).join('/')
    window.open(`https://www.google.com/maps/dir/${origin}/${addresses}`, '_blank')
  }

  if (loading || (!isLoaded && !loadError)) {
    return <><ChoferHeader title="Ruta" back /><LoadingSpinner fullScreen /></>
  }

  if (loadError) {
    return (
      <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
        <ChoferHeader title="Ruta" back />
        <div className="p-4 text-center text-red-500">
          Error cargando Google Maps. Verificá la API key.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
      <ChoferHeader title="Ruta" back />
      <div className="flex flex-col" style={{ height: 'calc(100dvh - 56px - 64px)' }}>
        {hasDespachoOrder && (
          <div className="px-4 py-2 bg-accent/10 border-b border-accent/20 flex items-center justify-between gap-3">
            <span className="text-accent text-xs font-medium">📋 Orden planificado por logística</span>
            {myDespacho?.plantaId && (
              <span className="text-xs text-accent/80 shrink-0 font-medium">
                🏭 {PLANTAS[myDespacho.plantaId].label}
                {myDespacho.horaSalida && ` · ${myDespacho.horaSalida}`}
              </span>
            )}
          </div>
        )}

        <div className="p-3 flex flex-wrap gap-2 bg-white border-b border-[#D3D1C7] shrink-0 shadow-sm">
          <Button
            onClick={calculateRoute}
            loading={calculating}
            disabled={orderedPending.length === 0}
            className="text-sm"
          >
            🗺 Calcular ruta ({orderedPending.length} paradas)
          </Button>
          <Button
            variant="outline"
            onClick={openAllInMaps}
            disabled={orderedPending.length === 0}
            className="text-sm"
          >
            Abrir en Google Maps ↗
          </Button>
          {directions && (
            <Button variant="ghost" onClick={() => setDirections(null)} className="text-sm">
              Limpiar ruta
            </Button>
          )}
        </div>

        {routeStale && !calculating && (
          <div className="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/30 flex items-center justify-between gap-3">
            <p className="text-yellow-400 text-xs">La ruta cambió — recalculá</p>
            <button
              onClick={calculateRoute}
              className="text-xs text-yellow-400 hover:text-yellow-300 underline shrink-0"
            >
              Recalcular
            </button>
          </div>
        )}

        {routeError && (
          <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30">
            <p className="text-red-400 text-xs">{routeError}</p>
          </div>
        )}

        <div className="flex-1 min-h-0">
          <GoogleMap
            mapContainerStyle={MAP_CONTAINER_STYLE}
            center={currentPos ?? BA_CENTER}
            zoom={13}
            options={MAP_OPTIONS}
          >
            {directions && (
              <>
                {/* Halo blanco para que la ruta resalte sobre cualquier fondo */}
                <DirectionsRenderer
                  directions={directions}
                  options={{
                    suppressMarkers: true,
                    polylineOptions: {
                      strokeColor:   '#ffffff',
                      strokeWeight:  11,
                      strokeOpacity: 0.85,
                      zIndex:        1,
                    },
                  }}
                />
                {/* Línea de ruta en el color acento de la app */}
                <DirectionsRenderer
                  directions={directions}
                  options={{
                    polylineOptions: {
                      strokeColor:   '#00C2FF',
                      strokeWeight:  6,
                      strokeOpacity: 1,
                      zIndex:        2,
                    },
                    suppressMarkers: true,
                  }}
                />
                {routeMarkers?.plantaPos && (
                  <Marker
                    position={routeMarkers.plantaPos}
                    zIndex={5}
                    label={{ text: 'P', color: '#ffffff', fontWeight: 'bold', fontSize: '11px' }}
                    icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#1D9E75', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 }}
                  />
                )}
                {routeMarkers?.stops.map((pos, i) => (
                  <Marker
                    key={i}
                    position={pos}
                    zIndex={6}
                    label={{ text: String(i + 1), color: '#ffffff', fontWeight: 'bold', fontSize: '12px' }}
                    icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: '#00C2FF', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 }}
                  />
                ))}
              </>
            )}
          </GoogleMap>
        </div>

        {orderedPending.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={orderedPending.map((o) => o.id)} strategy={verticalListSortingStrategy}>
              <div className="bg-white border-t border-[#D3D1C7] max-h-48 overflow-y-auto shrink-0 shadow-[0_-1px_6px_rgba(0,0,0,0.05)]">
                {orderedPending.map((o, i) => (
                  <SortableStop key={o.id} order={o} index={i} />
                ))}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeId && (() => {
                const o = orderedPending.find((x) => x.id === activeId)
                if (!o) return null
                return (
                  <div className="bg-white border border-accent/40 rounded-xl px-4 py-3 shadow-2xl flex items-center gap-3 opacity-95">
                    <span className="w-6 h-6 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold shrink-0">
                      {orderedPending.indexOf(o) + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{o.clientName}</p>
                      <p className="text-xs text-gray-500 truncate">{o.clientAddress}</p>
                    </div>
                  </div>
                )
              })()}
            </DragOverlay>
          </DndContext>
        )}

        {orderedPending.length === 0 && (
          <div className="p-4 text-center text-accent bg-white border-t border-[#D3D1C7] font-medium">
            ✓ Todas las entregas del día completadas
          </div>
        )}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#D3D1C7] flex z-30 shadow-[0_-1px_8px_rgba(0,0,0,0.06)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <Link
          to="/chofer"
          className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
          </svg>
          <span>Entregas</span>
        </Link>

        <Link
          to="/chofer/map"
          className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium text-accent transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <span>Ruta</span>
        </Link>

        <button
          onClick={async () => {
            if (!pending.length) return
            setPdfLoading(true)
            const name = user?.nombreContacto || user?.nombre || 'Chofer'
            await generateHojaDeRuta(pending, name)
            setPdfLoading(false)
          }}
          disabled={!pending.length || pdfLoading}
          className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium text-gray-400 hover:text-gray-700 disabled:opacity-40 transition-colors"
        >
          {pdfLoading ? (
            <span className="w-5 h-5 border-2 border-muted border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          )}
          <span>PDF</span>
        </button>
      </nav>

    </div>
  )
}
