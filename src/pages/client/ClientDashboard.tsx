import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { GoogleMap, Marker } from '@react-google-maps/api'
import Navbar from '../../components/layout/Navbar'
import Badge from '../../components/ui/Badge'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useClientOrders } from '../../hooks/useOrders'
import { useAuth } from '../../context/AuthContext'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { subscribeDriverLocation } from '../../services/locationService'
import { formatShortDate, summarizeProducts } from '../../utils/helpers'
import { Order, getPrimaryAddress } from '../../types'

// ── Estilos del mapa ──────────────────────────────────────────────────────────

const MAP_CONTAINER: React.CSSProperties = { width: '100%', height: '100%' }

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry',           stylers: [{ color: '#0A1628' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A1628' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#74a0c8' }] },
  { featureType: 'road',               elementType: 'geometry',         stylers: [{ color: '#1E3A5F' }] },
  { featureType: 'road.highway',       elementType: 'geometry',         stylers: [{ color: '#163868' }] },
  { featureType: 'water',              elementType: 'geometry',         stylers: [{ color: '#05101e' }] },
  { featureType: 'poi',                elementType: 'geometry',         stylers: [{ color: '#0e1f38' }] },
  { featureType: 'transit',            elementType: 'geometry',         stylers: [{ color: '#1E3A5F' }] },
]

const BA_DEFAULT = { lat: -34.6037, lng: -58.3816 }

const TRUCK_ICON_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44">' +
  '<circle cx="22" cy="22" r="20" fill="#00C2FF" stroke="white" stroke-width="2.5"/>' +
  '<text x="22" y="30" font-size="22" text-anchor="middle">🚛</text>' +
  '</svg>',
)

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

        {enCaminoOrder && <TruckTracker order={enCaminoOrder} />}

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

type Coords = { lat: number; lng: number }

function TruckTracker({ order }: { order: Order }) {
  const { isLoaded }                    = useGoogleMapsLoader()
  const mapRef                          = useRef<google.maps.Map | null>(null)
  const hasFitted                       = useRef(false)
  const [truckPos,    setTruckPos]      = useState<Coords | null>(null)
  const [deliveryPos, setDeliveryPos]   = useState<Coords | null>(null)

  // Suscripción en tiempo real a la ubicación del chofer
  useEffect(() => {
    if (!order.driverId) return
    hasFitted.current = false
    return subscribeDriverLocation(order.driverId, setTruckPos)
  }, [order.driverId])

  // Geocodifica la dirección de entrega una sola vez
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

  // Ajusta el encuadre del mapa la primera vez que se conocen ambas posiciones
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

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent" />
        </span>
        <h2 className="text-lg font-semibold">Tu pedido está en camino</h2>
      </div>
      <p className="text-muted text-sm -mt-1">Ubicación del camión en tiempo real</p>

      <div
        className="rounded-xl overflow-hidden border border-accent/30"
        style={{ height: '220px' }}
      >
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={MAP_CONTAINER}
            center={deliveryPos ?? truckPos ?? BA_DEFAULT}
            zoom={13}
            options={{
              disableDefaultUI:  true,
              zoomControl:       true,
              gestureHandling:   'cooperative',
              styles:            DARK_MAP_STYLES,
            }}
            onLoad={(m) => { mapRef.current = m }}
          >
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
            {deliveryPos && (
              <Marker position={deliveryPos} />
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
