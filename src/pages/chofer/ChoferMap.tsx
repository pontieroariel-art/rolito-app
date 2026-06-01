import { useMemo, useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { GoogleMap, DirectionsRenderer } from '@react-google-maps/api'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useDriverOrders } from '../../hooks/useOrders'
import { markDelivered } from '../../services/orderService'
import EntregaModal from '../../components/chofer/EntregaModal'
import { updateDriverLocation, deactivateDriverLocation } from '../../services/locationService'
import { useAuth } from '../../context/AuthContext'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { summarizeProducts } from '../../utils/helpers'
import { generateHojaDeRuta } from '../../utils/pdf'

const BA_CENTER = { lat: -34.6037, lng: -58.3816 }

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
  const [skippedIds, setSkippedIds]     = useState<Set<string>>(new Set())
  const [routeStale, setRouteStale]     = useState(false)
  const [deliveryOrder, setDeliveryOrder] = useState<import('../../types').Order | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

  const pending = useMemo(
    () => orders.filter((o) => o.status !== 'entregado' && o.clientAddress),
    [orders],
  )

  const activeOrders   = useMemo(() => pending.filter((o) => !skippedIds.has(o.id)), [pending, skippedIds])
  const skippedOrders  = useMemo(() => pending.filter((o) =>  skippedIds.has(o.id)), [pending, skippedIds])
  const orderedPending = useMemo(() => [...activeOrders, ...skippedOrders],           [activeOrders, skippedOrders])

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
      const service     = new google.maps.DirectionsService()
      const origin      = currentPos ?? orderedPending[0].clientAddress
      const allStops    = currentPos ? orderedPending : orderedPending.slice(1)
      const destination = allStops[allStops.length - 1].clientAddress
      const waypoints   = allStops.slice(0, -1).map((o) => ({
        location: o.clientAddress,
        stopover: true,
      }))

      const result = await service.route({
        origin,
        destination,
        waypoints,
        optimizeWaypoints: skippedOrders.length === 0,
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
        <div className="p-3 flex flex-wrap gap-2 bg-surface border-b border-border shrink-0">
          <Button
            onClick={calculateRoute}
            loading={calculating}
            disabled={orderedPending.length === 0}
            className="text-sm"
          >
            🗺 Calcular ruta ({activeOrders.length} paradas{skippedOrders.length > 0 ? ` + ${skippedOrders.length} postergadas` : ''})
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
          <div className="bg-surface border-t border-border max-h-48 overflow-y-auto shrink-0">
            {orderedPending.map((o, i) => {
              const isSkipped = skippedIds.has(o.id)
              return (
                <div
                  key={o.id}
                  className={`flex justify-between items-center px-4 py-3 border-b border-border/50 last:border-0 gap-3 ${isSkipped ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold shrink-0 ${isSkipped ? 'bg-orange-500/20 text-orange-400' : 'bg-accent/20 text-accent'}`}>
                      {isSkipped ? '↩' : i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{o.clientName}</p>
                        {isSkipped && <span className="text-xs text-orange-400 shrink-0">postergado</span>}
                      </div>
                      <p className="text-xs text-muted truncate">{o.clientAddress}</p>
                      <p className="text-xs text-muted/70">{summarizeProducts(o.products)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isSkipped ? (
                      <button
                        onClick={() => unskipOrder(o.id)}
                        className="text-xs text-orange-400 hover:text-orange-300 px-2 py-1 border border-orange-400/30 rounded-lg"
                      >
                        Restaurar
                      </button>
                    ) : (
                      <button
                        onClick={() => skipOrder(o.id)}
                        className="text-xs text-muted hover:text-yellow-400 px-2 py-1 border border-border rounded-lg"
                        title="Saltear esta parada"
                      >
                        ⏭
                      </button>
                    )}
                    <Button
                      onClick={() => setDeliveryOrder(o)}
                      className="text-xs py-1.5 px-3"
                    >
                      ✓
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
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
