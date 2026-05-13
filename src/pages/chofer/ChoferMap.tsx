import { useMemo, useState, useEffect, useRef } from 'react'
import { GoogleMap, DirectionsRenderer } from '@react-google-maps/api'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useDriverOrders } from '../../hooks/useOrders'
import { updateOrderStatus } from '../../services/orderService'
import { updateDriverLocation, deactivateDriverLocation } from '../../services/locationService'
import { useAuth } from '../../context/AuthContext'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { summarizeProducts } from '../../utils/helpers'

const BA_CENTER = { lat: -34.6037, lng: -58.3816 }

const MAP_CONTAINER_STYLE: React.CSSProperties = { width: '100%', height: '100%' }

const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry',           stylers: [{ color: '#03160D' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#03160D' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#40916C' }] },
  { featureType: 'administrative',     elementType: 'geometry', stylers: [{ color: '#1B4332' }] },
  { featureType: 'road',               elementType: 'geometry', stylers: [{ color: '#1B4332' }] },
  { featureType: 'road.highway',       elementType: 'geometry', stylers: [{ color: '#2D6A4F' }] },
  { featureType: 'road',               elementType: 'labels.text.fill', stylers: [{ color: '#52B788' }] },
  { featureType: 'water',              elementType: 'geometry', stylers: [{ color: '#011507' }] },
  { featureType: 'water',              elementType: 'labels.text.fill', stylers: [{ color: '#1B4332' }] },
  { featureType: 'poi',                elementType: 'geometry', stylers: [{ color: '#081C11' }] },
  { featureType: 'poi.park',           elementType: 'geometry', stylers: [{ color: '#0B2C1C' }] },
  { featureType: 'transit',            elementType: 'geometry', stylers: [{ color: '#1B4332' }] },
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

  const pending = useMemo(
    () => orders.filter((o) => o.status !== 'entregado' && o.clientAddress),
    [orders],
  )

  const nombreRef   = useRef(user?.nombreContacto || user?.nombre || '')
  const telefonoRef = useRef(user?.telefono       || user?.phone  || '')
  useEffect(() => {
    nombreRef.current   = user?.nombreContacto || user?.nombre || ''
    telefonoRef.current = user?.telefono       || user?.phone  || ''
  })

  // Comparte ubicación GPS cada 10 s mientras el mapa está abierto y hay pendientes
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
    if (pending.length === 0) return
    setCalculating(true)
    setRouteError('')

    try {
      const service  = new google.maps.DirectionsService()
      const origin   = currentPos ?? pending[0].clientAddress
      const destination = pending[pending.length - 1].clientAddress
      const waypoints   = (currentPos ? pending : pending.slice(1)).slice(0, -1).map((o) => ({
        location: o.clientAddress,
        stopover: true,
      }))

      const result = await service.route({
        origin,
        destination,
        waypoints,
        optimizeWaypoints: true,
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

  const openAllInMaps = () => {
    if (pending.length === 0) return
    const origin    = currentPos ? `${currentPos.lat},${currentPos.lng}` : encodeURIComponent(pending[0].clientAddress)
    const addresses = pending.map((o) => encodeURIComponent(o.clientAddress)).join('/')
    window.open(`https://www.google.com/maps/dir/${origin}/${addresses}`, '_blank')
  }

  const markDelivered = async (orderId: string) => {
    await updateOrderStatus(orderId, 'entregado')
    setDirections(null)
  }

  if (loading || (!isLoaded && !loadError)) {
    return <><Navbar /><LoadingSpinner fullScreen /></>
  }

  if (loadError) {
    return (
      <>
        <Navbar />
        <div className="p-4 text-center text-red-400">
          Error cargando Google Maps. Verificá la API key.
        </div>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <div className="flex flex-col" style={{ height: 'calc(100vh - 57px)' }}>
        <div className="p-3 flex flex-wrap gap-2 bg-surface border-b border-border shrink-0">
          <Button
            onClick={calculateRoute}
            loading={calculating}
            disabled={pending.length === 0}
            className="text-sm"
          >
            🗺 Calcular ruta ({pending.length} paradas)
          </Button>
          <Button
            variant="outline"
            onClick={openAllInMaps}
            disabled={pending.length === 0}
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
                  polylineOptions: { strokeColor: '#52B788', strokeWeight: 4 },
                  markerOptions:   { visible: true },
                }}
              />
            )}
          </GoogleMap>
        </div>

        {pending.length > 0 && (
          <div className="bg-surface border-t border-border max-h-52 overflow-y-auto shrink-0">
            {pending.map((o, i) => (
              <div
                key={o.id}
                className="flex justify-between items-center px-4 py-3 border-b border-border/50 last:border-0 gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-6 h-6 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{o.clientName}</p>
                    <p className="text-xs text-muted truncate">{o.clientAddress}</p>
                    <p className="text-xs text-muted/70">{summarizeProducts(o.products)}</p>
                  </div>
                </div>
                <Button
                  onClick={() => markDelivered(o.id)}
                  className="text-xs py-1 px-3 shrink-0"
                  variant="success"
                >
                  ✓
                </Button>
              </div>
            ))}
          </div>
        )}

        {pending.length === 0 && (
          <div className="p-4 text-center text-success bg-surface border-t border-border">
            ✓ Todas las entregas del día completadas
          </div>
        )}
      </div>
    </>
  )
}
