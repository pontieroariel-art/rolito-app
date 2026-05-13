import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { GoogleMap, Marker, DirectionsRenderer } from '@react-google-maps/api'
import Navbar from '../../components/layout/Navbar'
import Badge from '../../components/ui/Badge'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useClientOrders } from '../../hooks/useOrders'
import { useAuth } from '../../context/AuthContext'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { subscribeDriverLocation, DriverLocation } from '../../services/locationService'
import { useNotifyCerca } from '../../hooks/useNotifications'
import { formatShortDate, summarizeProducts } from '../../utils/helpers'
import { Order, getPrimaryAddress } from '../../types'

// ── Constantes ────────────────────────────────────────────────────────────────

const MAP_CONTAINER: React.CSSProperties = { width: '100%', height: '100%' }

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry',           stylers: [{ color: '#03160D' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#03160D' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#40916C' }] },
  { featureType: 'road',               elementType: 'geometry', stylers: [{ color: '#1B4332' }] },
  { featureType: 'road.highway',       elementType: 'geometry', stylers: [{ color: '#2D6A4F' }] },
  { featureType: 'water',              elementType: 'geometry', stylers: [{ color: '#011507' }] },
  { featureType: 'poi',                elementType: 'geometry', stylers: [{ color: '#081C11' }] },
  { featureType: 'transit',            elementType: 'geometry', stylers: [{ color: '#1B4332' }] },
]

const BA_DEFAULT = { lat: -34.6037, lng: -58.3816 }

const TRUCK_ICON_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44">' +
  '<circle cx="22" cy="22" r="20" fill="#2D6A4F" stroke="white" stroke-width="2.5"/>' +
  '<text x="22" y="30" font-size="22" text-anchor="middle">🚛</text>' +
  '</svg>',
)

// ── Haversine ─────────────────────────────────────────────────────────────────

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

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function ClientDashboard() {
  const { user }            = useAuth()
  const { orders, loading } = useClientOrders()

  const active        = orders.filter((o) => !['entregado', 'cancelado'].includes(o.status))
  const delivered     = orders.filter((o) => o.status === 'entregado')
  const recent        = orders.slice(0, 5)
  const enCaminoOrder = orders.find((o) => o.status === 'en_camino') ?? null
  const primaryAddr   = user ? getPrimaryAddress(user) : null
  const hasAddress    = !!(primaryAddr?.address || user?.address)

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold">
            Hola, {(user?.nombreContacto || user?.nombre)?.split(' ')[0] ?? 'amigo'} 👋
          </h1>
          <p className="text-muted text-sm mt-1">Gestión de pedidos de hielo</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Pedidos activos"    value={active.length}    color="text-accent" />
          <StatCard label="Pedidos entregados" value={delivered.length} color="text-success" />
        </div>

        {enCaminoOrder && (
          <TruckTracker
            order={enCaminoOrder}
            clientEmail={user?.email ?? ''}
            clientNombre={(user?.nombreContacto || user?.nombre || '').split(' ')[0] || 'Cliente'}
          />
        )}

        {!hasAddress && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm">
            <p className="text-yellow-400 font-medium">⚠ Completá tu perfil</p>
            <p className="text-yellow-400/70 mt-1">
              Necesitás agregar una dirección de entrega para hacer pedidos.{' '}
              <Link to="/perfil" className="underline hover:text-yellow-300">
                Ir a Mi perfil →
              </Link>
            </p>
          </div>
        )}

        <Link
          to="/nuevo-pedido"
          className="flex items-center justify-center gap-2 w-full bg-accent text-bg font-semibold py-3 rounded-xl hover:bg-accent/90 transition-colors text-sm"
        >
          + Hacer nuevo pedido
        </Link>

        <section>
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold">Pedidos recientes</h2>
            {orders.length > 5 && (
              <Link to="/historial" className="text-accent text-sm hover:underline">
                Ver todos
              </Link>
            )}
          </div>

          {recent.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-8 text-center">
              <p className="text-muted text-sm">Aún no tenés pedidos</p>
              <p className="text-muted/60 text-xs mt-1">
                Hacé tu primer pedido usando el botón de arriba
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recent.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  )
}

// ── TruckTracker ──────────────────────────────────────────────────────────────

function TruckTracker({
  order,
  clientEmail,
  clientNombre,
}: {
  order:        Order
  clientEmail:  string
  clientNombre: string
}) {
  const { isLoaded }        = useGoogleMapsLoader()
  const mapRef              = useRef<google.maps.Map | null>(null)
  const hasFitted           = useRef(false)
  const hasSentNotif        = useRef(false)
  const notifyCercaMutation = useNotifyCerca()

  const [driverData,   setDriverData]   = useState<DriverLocation | null>(null)
  const [deliveryPos,  setDeliveryPos]  = useState<Coords | null>(null)
  const [directions,   setDirections]   = useState<google.maps.DirectionsResult | null>(null)
  const [eta,          setEta]          = useState<string | null>(null)
  const [expanded,     setExpanded]     = useState(false)

  const truckPos: Coords | null = driverData ? { lat: driverData.lat, lng: driverData.lng } : null

  // Distancia en metros entre camión y destino
  const distance =
    truckPos && deliveryPos ? haversineMeters(truckPos, deliveryPos) : null

  // ── Suscripción al chofer ──────────────────────────────────────────────────
  useEffect(() => {
    if (!order.driverId) return
    hasFitted.current = false
    return subscribeDriverLocation(order.driverId, setDriverData)
  }, [order.driverId])

  // ── Geocodificar dirección de entrega (una sola vez) ──────────────────────
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

  // ── Calcular ruta y ETA cuando el camión se mueve ────────────────────────
  useEffect(() => {
    if (!isLoaded || !truckPos || !deliveryPos) return
    const svc = new google.maps.DirectionsService()
    svc.route(
      {
        origin:      truckPos,
        destination: deliveryPos,
        travelMode:  google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === 'OK' && result) {
          setDirections(result)
          setEta(result.routes[0]?.legs[0]?.duration?.text ?? null)
        }
      },
    )
  }, [isLoaded, truckPos, deliveryPos])

  // ── Auto-fit al mapa (una sola vez) ──────────────────────────────────────
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

  // ── Notificación de proximidad (1 km, una sola vez) ──────────────────────
  useEffect(() => {
    if (!distance || hasSentNotif.current || !clientEmail) return
    if (distance < 1000) {
      hasSentNotif.current = true
      notifyCercaMutation.mutate({
        email:    clientEmail,
        nombre:   clientNombre,
        products: order.products,
      })
    }
  }, [distance, clientEmail, clientNombre, order.products])

  const isNearby = distance !== null && distance < 500

  return (
    <section className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent" />
        </span>
        <h2 className="text-lg font-semibold">Tu pedido está en camino</h2>
      </div>

      {/* Alerta de proximidad 500m */}
      {isNearby && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-2xl">⏱️</span>
          <p className="text-accent font-semibold text-sm">Tu pedido llega en minutos</p>
        </div>
      )}

      {/* Info chofer + ETA */}
      {(driverData?.nombreChofer || eta) && (
        <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
          <p className="text-xs text-muted uppercase tracking-widest">Tu pedido lo entrega</p>
          {/* Fila superior: avatar + nombre + estado */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-white font-bold text-sm shrink-0">
                {driverData?.nombreChofer?.charAt(0).toUpperCase() ?? '🚛'}
              </div>
              <div>
                <p className="font-semibold text-sm">{driverData?.nombreChofer ?? 'Chofer en camino'}</p>
                <p className="text-xs text-success flex items-center gap-1 mt-0.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" />
                  En camino
                </p>
              </div>
            </div>
            {driverData?.telefonoChofer && (
              <a
                href={`tel:${driverData.telefonoChofer}`}
                className="flex items-center gap-1.5 bg-accent/10 border border-accent/30 text-accent text-xs font-medium px-3 py-2 rounded-lg hover:bg-accent/20 transition-colors shrink-0"
              >
                📞 Llamar
              </a>
            )}
          </div>

          {/* Fila inferior: ETA + distancia */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
            <div className="text-center">
              <p className="text-xs text-muted">Tiempo estimado</p>
              <p className="text-lg font-bold text-white mt-0.5">{eta ?? '—'}</p>
            </div>
            <div className="text-center border-l border-border">
              <p className="text-xs text-muted">Distancia</p>
              <p className="text-lg font-bold text-white mt-0.5">
                {distance !== null
                  ? distance < 1000
                    ? `${Math.round(distance)} m`
                    : `${(distance / 1000).toFixed(1)} km`
                  : '—'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Mapa */}
      <div
        className="rounded-xl overflow-hidden border border-accent/30 relative transition-all duration-300"
        style={{ height: expanded ? '420px' : '240px' }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className="absolute top-2 right-2 z-10 bg-surface/80 backdrop-blur-sm border border-border rounded-lg px-2 py-1 text-xs text-muted hover:text-white transition-colors"
        >
          {expanded ? '⊠ Reducir' : '⊞ Expandir'}
        </button>
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={MAP_CONTAINER}
            center={deliveryPos ?? truckPos ?? BA_DEFAULT}
            zoom={13}
            options={{
              disableDefaultUI: true,
              zoomControl:      true,
              gestureHandling:  'cooperative',
              styles:           DARK_MAP_STYLES,
            }}
            onLoad={(m) => { mapRef.current = m }}
          >
            {/* Ruta */}
            {directions && (
              <DirectionsRenderer
                directions={directions}
                options={{
                  suppressMarkers:  true,
                  polylineOptions: {
                    strokeColor:   '#52B788',
                    strokeWeight:  4,
                    strokeOpacity: 0.85,
                  },
                }}
              />
            )}

            {/* Pin camión */}
            {truckPos && (
              <Marker
                position={truckPos}
                icon={{
                  url:        `data:image/svg+xml;charset=UTF-8,${TRUCK_ICON_SVG}`,
                  scaledSize: new google.maps.Size(44, 44),
                  anchor:     new google.maps.Point(22, 22),
                }}
              />
            )}

            {/* Pin destino */}
            {deliveryPos && (
              <Marker
                position={deliveryPos}
                label={{ text: '📍', fontSize: '20px' }}
                icon={{
                  url:        'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
                  scaledSize: new google.maps.Size(1, 1),
                }}
              />
            )}
          </GoogleMap>
        ) : (
          <div className="w-full h-full bg-surface animate-pulse" />
        )}
      </div>

      {!truckPos && (
        <p className="text-muted text-xs text-center">
          Esperando la ubicación del chofer...
        </p>
      )}
    </section>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <p className="text-muted text-sm">{label}</p>
      <p className={`text-4xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  )
}

function OrderRow({ order }: { order: Order }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex justify-between items-start gap-3">
      <div className="min-w-0">
        <p className="font-medium text-sm truncate">{summarizeProducts(order.products)}</p>
        <p className="text-muted text-xs mt-1">Entrega: {formatShortDate(order.date)}</p>
      </div>
      <Badge status={order.status} />
    </div>
  )
}
