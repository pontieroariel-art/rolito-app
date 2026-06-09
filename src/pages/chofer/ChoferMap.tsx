import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { GoogleMap, DirectionsRenderer } from '@react-google-maps/api'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  MouseSensor, TouchSensor, useSensor, useSensors,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useDriverOrders } from '../../hooks/useOrders'
import { markDelivered } from '../../services/orderService'
import EntregaModal from '../../components/chofer/EntregaModal'
import { updateDriverLocation, deactivateDriverLocation } from '../../services/locationService'
import { subscribeMyDespacho, todayStr } from '../../services/despachoService'
import { useAuth } from '../../context/AuthContext'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { summarizeProducts } from '../../utils/helpers'
import { generateHojaDeRuta } from '../../utils/pdf'
import type { Despacho, Order } from '../../types'
import { PLANTAS } from '../../types'

const BA_CENTER = { lat: -34.6037, lng: -58.3816 }

// ── SortableStop ──────────────────────────────────────────────────────────────

function SortableStop({ order, index, isSkipped, onSkip, onUnskip, onDeliver }: {
  order:     Order
  index:     number
  isSkipped: boolean
  onSkip:    (id: string) => void
  onUnskip:  (id: string) => void
  onDeliver: (o: Order) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: order.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      className={`flex justify-between items-center px-4 py-3 border-b border-border/50 last:border-0 gap-3 ${isSkipped ? 'opacity-50' : ''} ${isDragging ? 'bg-surface/80' : ''}`}
    >
      {/* Handle de arrastre + número */}
      <div
        {...listeners} {...attributes}
        className="flex items-center gap-3 cursor-grab active:cursor-grabbing touch-none shrink-0"
        style={{ touchAction: 'none' }}
      >
        <div className="flex flex-col gap-0.5 text-muted/40 hover:text-muted transition-colors px-0.5">
          <span className="block w-3.5 h-0.5 bg-current rounded-full" />
          <span className="block w-3.5 h-0.5 bg-current rounded-full" />
          <span className="block w-3.5 h-0.5 bg-current rounded-full" />
        </div>
        <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold ${isSkipped ? 'bg-orange-500/20 text-orange-400' : 'bg-accent/20 text-accent'}`}>
          {isSkipped ? '↩' : index + 1}
        </span>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{order.clientName}</p>
          {isSkipped && <span className="text-xs text-orange-400 shrink-0">postergado</span>}
        </div>
        <p className="text-xs text-muted truncate">{order.clientAddress}</p>
        <p className="text-xs text-muted/70">{summarizeProducts(order.products)}</p>
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isSkipped ? (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onUnskip(order.id)}
            className="text-xs text-orange-400 hover:text-orange-300 px-2 py-1 border border-orange-400/30 rounded-lg"
          >
            Restaurar
          </button>
        ) : (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onSkip(order.id)}
            className="text-xs text-muted hover:text-yellow-400 px-2 py-1 border border-border rounded-lg"
            title="Saltear esta parada"
          >
            ⏭
          </button>
        )}
        <Button
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          onClick={() => onDeliver(order)}
          className="text-xs py-1.5 px-3"
        >
          ✓
        </Button>
      </div>
    </div>
  )
}

const MAP_CONTAINER_STYLE: React.CSSProperties = { width: '100%', height: '100%' }

const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry',           stylers: [{ color: '#111110' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#111110' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#888780' }] },
  { featureType: 'administrative',     elementType: 'geometry', stylers: [{ color: '#2C2C2A' }] },
  { featureType: 'road',               elementType: 'geometry', stylers: [{ color: '#2C2C2A' }] },
  { featureType: 'road.highway',       elementType: 'geometry', stylers: [{ color: '#1D9E75' }] },
  { featureType: 'road',               elementType: 'labels.text.fill', stylers: [{ color: '#888780' }] },
  { featureType: 'water',              elementType: 'geometry', stylers: [{ color: '#0A0A09' }] },
  { featureType: 'water',              elementType: 'labels.text.fill', stylers: [{ color: '#2C2C2A' }] },
  { featureType: 'poi',                elementType: 'geometry', stylers: [{ color: '#1C1C1A' }] },
  { featureType: 'poi.park',           elementType: 'geometry', stylers: [{ color: '#1A2A1A' }] },
  { featureType: 'transit',            elementType: 'geometry', stylers: [{ color: '#2C2C2A' }] },
]

const MAP_OPTIONS: google.maps.MapOptions = {
  styles:            DARK_MAP_STYLE,
  streetViewControl: false,
  mapTypeControl:    false,
  fullscreenControl: true,
}

export default function ChoferMap() {
  const { orders, loading }           = useDriverOrders()
  const { user }                      = useAuth()
  const { isLoaded, loadError }       = useGoogleMapsLoader()
  const [directions, setDirections]   = useState<google.maps.DirectionsResult | null>(null)
  const [routeError, setRouteError]   = useState('')
  const [calculating, setCalculating] = useState(false)
  const [currentPos, setCurrentPos]   = useState<google.maps.LatLngLiteral | null>(null)
  const [skippedIds, setSkippedIds]   = useState<Set<string>>(new Set())
  const [routeStale, setRouteStale]   = useState(false)
  const [deliveryOrder, setDeliveryOrder] = useState<Order | null>(null)
  const [pdfLoading, setPdfLoading]   = useState(false)
  const [myDespacho,  setMyDespacho]  = useState<Despacho | null>(null)
  const [manualOrder, setManualOrder] = useState<string[]>([]) // IDs en orden manual del chofer
  const [activeId,    setActiveId]    = useState<string | null>(null)

  // Suscribirse al despacho del día para respetar el orden de logística
  useEffect(() => {
    if (!user?.email) return
    return subscribeMyDespacho(todayStr(), user.email, setMyDespacho)
  }, [user?.email])

  const pending = useMemo(
    () => orders.filter((o) => o.status !== 'entregado' && o.clientAddress),
    [orders],
  )

  const hasDespachoOrder = myDespacho?.status === 'confirmado' && (myDespacho.orderIds?.length ?? 0) > 0

  // Calcular el orden base (de logística o por defecto)
  const baseOrder = useMemo<Order[]>(() => {
    if (hasDespachoOrder) {
      const orderIdOrder = myDespacho!.orderIds
        .filter((x) => x.startsWith('o:'))
        .map((x) => x.slice(2))
      const byId  = new Map(pending.map((o) => [o.id, o]))
      const sorted = orderIdOrder.map((id) => byId.get(id)).filter(Boolean) as Order[]
      const inSet  = new Set(orderIdOrder)
      const extra  = pending.filter((o) => !inSet.has(o.id))
      return [...sorted, ...extra]
    }
    return pending
  }, [hasDespachoOrder, myDespacho, pending])

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
    const active  = manualOrder.map((id) => byId.get(id)).filter((o): o is Order => !!o && !skippedIds.has(o.id))
    const skipped = pending.filter((o) => skippedIds.has(o.id))
    return [...active, ...skipped]
  }, [pending, manualOrder, skippedIds])

  const activeOrders  = useMemo(() => orderedPending.filter((o) => !skippedIds.has(o.id)), [orderedPending, skippedIds])
  const skippedOrders = useMemo(() => orderedPending.filter((o) =>  skippedIds.has(o.id)), [orderedPending, skippedIds])

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

  useEffect(() => {
    if (!pending.length || !user?.email || !navigator.geolocation) return
    const email = user.email
    const send  = () =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude })
          updateDriverLocation(email, pos.coords.latitude, pos.coords.longitude,
            nombreRef.current, telefonoRef.current)
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      )
    send()
    const id = setInterval(send, 10_000)
    return () => {
      clearInterval(id)
      deactivateDriverLocation(email).catch(console.error)
    }
  }, [pending.length, user?.email])

  const calculateRoute = async () => {
    if (orderedPending.length === 0) return
    setCalculating(true)
    setRouteError('')
    setRouteStale(false)

    try {
      const service = new google.maps.DirectionsService()
      const plantaCoords = myDespacho?.plantaId ? PLANTAS[myDespacho.plantaId] : null
      const plantaLatLng = plantaCoords ? { lat: plantaCoords.lat, lng: plantaCoords.lng } : null
      const origin   = currentPos ?? plantaLatLng ?? orderedPending[0].clientAddress
      const allStops = (currentPos || plantaLatLng) ? orderedPending : orderedPending.slice(1)
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
        optimizeWaypoints: !hasDespachoOrder && skippedOrders.length === 0,
        travelMode:        google.maps.TravelMode.DRIVING,
        region:            'AR',
      })
      setDirections(result)
    } catch {
      setRouteError('No se pudo calcular la ruta. Verificá que las direcciones sean correctas.')
    } finally {
      setCalculating(false)
    }
  }

  const skipOrder = (orderId: string) => {
    setSkippedIds((prev) => new Set([...prev, orderId]))
    setDirections(null)
    setRouteStale(true)
  }

  const unskipOrder = (orderId: string) => {
    setSkippedIds((prev) => {
      const next = new Set(prev)
      next.delete(orderId)
      return next
    })
    setDirections(null)
    setRouteStale(true)
  }

  const openAllInMaps = () => {
    if (orderedPending.length === 0) return
    const origin    = currentPos ? `${currentPos.lat},${currentPos.lng}` : encodeURIComponent(orderedPending[0].clientAddress)
    const addresses = orderedPending.map((o) => encodeURIComponent(o.clientAddress)).join('/')
    window.open(`https://www.google.com/maps/dir/${origin}/${addresses}`, '_blank')
  }

  const handleDelivered = async (
    entregados: import('../../types').OrderProduct[],
    parcial: boolean,
    nota: string,
  ) => {
    if (!deliveryOrder) return
    await markDelivered(deliveryOrder.id, entregados, parcial, nota)
    setSkippedIds((prev) => {
      const next = new Set(prev)
      next.delete(deliveryOrder.id)
      return next
    })
    setDirections(null)
    setDeliveryOrder(null)
  }

  if (loading || (!isLoaded && !loadError)) {
    return <><Navbar /><LoadingSpinner fullScreen /></>
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-bg text-[#D3D1C7]">
        <Navbar />
        <div className="p-4 text-center text-red-400">
          Error cargando Google Maps. Verificá la API key.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-[#D3D1C7]">
      <Navbar />
      <div className="flex flex-col" style={{ height: 'calc(100vh - 56px - 64px)' }}>
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

        <div className="p-3 flex flex-wrap gap-2 bg-surface border-b border-border shrink-0">
          <Button
            onClick={calculateRoute}
            loading={calculating}
            disabled={orderedPending.length === 0}
            className="text-sm"
          >
            🗺 Calcular ruta ({activeOrders.filter((o) => !skippedIds.has(o.id)).length} paradas{skippedOrders.length > 0 ? ` + ${skippedOrders.length} postergadas` : ''})
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
            <p className="text-yellow-400 text-xs">
              {skippedOrders.length > 0
                ? `${skippedOrders.length} parada${skippedOrders.length > 1 ? 's' : ''} postergada${skippedOrders.length > 1 ? 's' : ''} — recalculá la ruta`
                : 'La ruta cambió — recalculá'}
            </p>
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
              <DirectionsRenderer
                directions={directions}
                options={{
                  polylineOptions: { strokeColor: '#1D9E75', strokeWeight: 4 },
                  markerOptions:   { visible: true },
                }}
              />
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
              <div className="bg-surface border-t border-border max-h-48 overflow-y-auto shrink-0">
                {orderedPending.map((o, i) => (
                  <SortableStop
                    key={o.id}
                    order={o}
                    index={i}
                    isSkipped={skippedIds.has(o.id)}
                    onSkip={skipOrder}
                    onUnskip={unskipOrder}
                    onDeliver={setDeliveryOrder}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeId && (() => {
                const o = orderedPending.find((x) => x.id === activeId)
                if (!o) return null
                return (
                  <div className="bg-surface border border-accent/40 rounded-xl px-4 py-3 shadow-2xl flex items-center gap-3 opacity-95">
                    <span className="w-6 h-6 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold shrink-0">
                      {orderedPending.indexOf(o) + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#D3D1C7] truncate">{o.clientName}</p>
                      <p className="text-xs text-muted truncate">{o.clientAddress}</p>
                    </div>
                  </div>
                )
              })()}
            </DragOverlay>
          </DndContext>
        )}

        {orderedPending.length === 0 && (
          <div className="p-4 text-center text-accent bg-surface border-t border-border">
            ✓ Todas las entregas del día completadas
          </div>
        )}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border flex z-30" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <Link
          to="/chofer"
          className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium text-muted hover:text-[#D3D1C7] transition-colors"
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
          className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium text-muted hover:text-[#D3D1C7] disabled:opacity-40 transition-colors"
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

      {deliveryOrder && (
        <EntregaModal
          order={deliveryOrder}
          onConfirm={handleDelivered}
          onClose={() => setDeliveryOrder(null)}
        />
      )}
    </div>
  )
}
