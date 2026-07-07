import { useState, useEffect, useRef, useMemo } from 'react'
import { GoogleMap, Marker, DirectionsRenderer } from '@react-google-maps/api'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { subscribeDriverLocation, DriverLocation } from '../../services/locationService'
import { useNotifyCerca } from '../../hooks/useNotifications'
import { Order } from '../../types'

const MAP_CONTAINER: React.CSSProperties = { width: '100%', height: '100%' }

const LIGHT_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: 'poi',     elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
]

const BA_DEFAULT = { lat: -34.6037, lng: -58.3816 }

type Coords = { lat: number; lng: number }

function haversineMeters(a: Coords, b: Coords): number {
  const R      = 6_371_000
  const toRad  = (x: number) => (x * Math.PI) / 180
  const dLat   = toRad(b.lat - a.lat)
  const dLng   = toRad(b.lng - a.lng)
  const h      =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

interface TruckTrackerProps {
  order:        Order
  clientEmail:  string
  clientNombre: string
  onNearby:     () => void
}

export function TruckTracker({ order, clientEmail, clientNombre, onNearby }: TruckTrackerProps) {
  const { isLoaded }        = useGoogleMapsLoader()
  const mapRef              = useRef<google.maps.Map | null>(null)
  const hasFitted           = useRef(false)
  const hasSentNotif        = useRef(false)
  const { mutate: notifyCerca } = useNotifyCerca()

  const [driverData,   setDriverData]   = useState<DriverLocation | null>(null)
  const [deliveryPos,  setDeliveryPos]  = useState<Coords | null>(null)
  const [directions,   setDirections]   = useState<google.maps.DirectionsResult | null>(null)
  const [eta,          setEta]          = useState<string | null>(null)
  const [expanded,     setExpanded]     = useState(false)

  const truckPos: Coords | null = useMemo(
    () => (driverData ? { lat: driverData.lat, lng: driverData.lng } : null),
    [driverData],
  )
  const distance = truckPos && deliveryPos ? haversineMeters(truckPos, deliveryPos) : null

  useEffect(() => {
    if (!order.driverId) return
    hasFitted.current = false
    return subscribeDriverLocation(order.driverId, setDriverData)
  }, [order.driverId])

  useEffect(() => {
    if (!isLoaded || !order.clientAddress) return
    const geocoder = new google.maps.Geocoder()
    geocoder.geocode({ address: order.clientAddress }, (results, status) => {
      if (status === 'OK' && results?.[0]) {
        const loc = results[0].geometry.location
        setDeliveryPos({ lat: loc.lat(), lng: loc.lng() })
      }
    })
  }, [isLoaded, order.clientAddress])

  useEffect(() => {
    if (!isLoaded || !truckPos || !deliveryPos) return
    const svc = new google.maps.DirectionsService()
    svc.route(
      { origin: truckPos, destination: deliveryPos, travelMode: google.maps.TravelMode.DRIVING },
      (result, status) => {
        if (status === 'OK' && result) {
          setDirections(result)
          setEta(result.routes[0]?.legs[0]?.duration?.text ?? null)
        }
      },
    )
  }, [isLoaded, truckPos, deliveryPos])

  useEffect(() => {
    if (!mapRef.current || hasFitted.current) return
    if (truckPos && deliveryPos) {
      const bounds = new google.maps.LatLngBounds()
      bounds.extend(truckPos)
      bounds.extend(deliveryPos)
      mapRef.current.fitBounds(bounds, 60)
      hasFitted.current = true
    } else if (truckPos) {
      mapRef.current.panTo(truckPos)
      mapRef.current.setZoom(14)
      hasFitted.current = true
    }
  }, [truckPos, deliveryPos])

  useEffect(() => {
    if (!distance || hasSentNotif.current || !clientEmail) return
    if (distance < 1000) {
      hasSentNotif.current = true
      notifyCerca({ orderId: order.id })
      onNearby()
    }
  }, [distance, clientEmail, order.id, notifyCerca, onNearby])

  const isNearby = distance !== null && distance < 500

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent" />
        </span>
        <h2 className="text-lg font-semibold text-gray-900">Tu pedido está en camino</h2>
      </div>

      {isNearby && (
        <div className="bg-[#E8F5F0] border border-[#B3DDD3] rounded-2xl px-4 py-3 flex items-center gap-3">
          <span className="text-2xl">⏱️</span>
          <p className="text-accent font-semibold text-sm">Tu pedido llega en minutos</p>
        </div>
      )}

      {(driverData?.nombreChofer || eta) && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
          <p className="text-xs text-gray-500 uppercase tracking-widest">Tu pedido lo entrega</p>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-white font-bold text-sm shrink-0">
                {driverData?.nombreChofer?.charAt(0).toUpperCase() ?? '🚛'}
              </div>
              <div>
                <p className="font-semibold text-sm text-gray-900">{driverData?.nombreChofer ?? 'Chofer en camino'}</p>
                <p className="text-xs text-accent flex items-center gap-1 mt-0.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />
                  En camino
                </p>
              </div>
            </div>
            {driverData?.telefonoChofer && (
              <a
                href={`tel:${driverData.telefonoChofer}`}
                className="flex items-center gap-1.5 bg-[#E8F5F0] border border-[#B3DDD3] text-accent text-xs font-medium px-3 py-2 rounded-lg hover:bg-accent/15 transition-colors shrink-0"
              >
                📞 Llamar
              </a>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
            <div className="text-center">
              <p className="text-xs text-gray-500">Tiempo estimado</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">{eta ?? '—'}</p>
            </div>
            <div className="text-center border-l border-gray-100">
              <p className="text-xs text-gray-500">Distancia</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">
                {distance !== null
                  ? distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`
                  : '—'}
              </p>
            </div>
          </div>
        </div>
      )}

      <div
        className="rounded-2xl overflow-hidden border border-gray-200 relative transition-all duration-300"
        style={{ height: expanded ? '420px' : '240px' }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Reducir mapa' : 'Expandir mapa'}
          className="absolute top-2 right-2 z-10 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-500 hover:text-gray-900 transition-colors"
        >
          {expanded ? '⊠ Reducir' : '⊞ Expandir'}
        </button>
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={MAP_CONTAINER}
            center={deliveryPos ?? truckPos ?? BA_DEFAULT}
            zoom={13}
            options={{ disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative', styles: LIGHT_MAP_STYLES }}
            onLoad={(m) => { mapRef.current = m }}
          >
            {directions && (
              <DirectionsRenderer
                directions={directions}
                options={{ suppressMarkers: true, polylineOptions: { strokeColor: '#1D9E75', strokeWeight: 4, strokeOpacity: 0.85 } }}
              />
            )}
            {truckPos && (
              <Marker
                position={truckPos}
                icon={{ url: '/camion-rolito.png', scaledSize: new google.maps.Size(90, 62), anchor: new google.maps.Point(45, 31) }}
              />
            )}
            {deliveryPos && (
              <Marker
                position={deliveryPos}
                label={{ text: '📍', fontSize: '20px' }}
                icon={{ url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), scaledSize: new google.maps.Size(1, 1) }}
              />
            )}
          </GoogleMap>
        ) : (
          <div className="w-full h-full bg-gray-100 animate-pulse" />
        )}
      </div>

      {!truckPos && (
        <p className="text-gray-400 text-xs text-center">Esperando la ubicación del chofer...</p>
      )}
    </section>
  )
}
