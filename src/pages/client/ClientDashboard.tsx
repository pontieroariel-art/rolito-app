import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useBranch } from '../../context/BranchContext'
import { usePushNotification } from '../../hooks/usePushNotification'
import { GoogleMap, Marker, DirectionsRenderer } from '@react-google-maps/api'
import Navbar from '../../components/layout/Navbar'
import Badge from '../../components/ui/Badge'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useClientOrders } from '../../hooks/useOrders'
import { useAuth } from '../../context/AuthContext'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { subscribeDriverLocation, DriverLocation } from '../../services/locationService'
import { savePushSubscription } from '../../services/userService'
import { cancelOrder } from '../../services/orderService'
import { getForecast, DayWeather } from '../../services/weatherService'
import { useNotifyCerca } from '../../hooks/useNotifications'
import { formatShortDate, summarizeProducts } from '../../utils/helpers'
import { Order, OrderStatus, OrderProduct, getPrimaryAddress, DIAS_SEMANA } from '../../types'
import { useRecurrente } from '../../hooks/useRecurrente'
import { useCatalogo } from '../../hooks/useCatalogo'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'

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
  const { user }               = useAuth()
  const { orders, loading }    = useClientOrders()
  const { selectedAddress }    = useBranch()
  const navigate               = useNavigate()
  const { isLoaded }           = useGoogleMapsLoader()

  const multiSucursal = (user?.addresses?.length ?? 0) > 1

  // Filtra pedidos por sucursal activa si tiene múltiples
  const branchOrders = useMemo(() => {
    if (!multiSucursal || !selectedAddress) return orders
    return orders.filter((o) => o.clientAddress === selectedAddress.address)
  }, [orders, multiSucursal, selectedAddress])

  const active        = branchOrders.filter((o) => !['entregado', 'cancelado'].includes(o.status))
  const delivered     = branchOrders.filter((o) => o.status === 'entregado')
  const recent        = branchOrders.slice(0, 5)
  const enCaminoOrder = branchOrders.find((o) => o.status === 'en_camino') ?? null
  const primaryAddr   = selectedAddress ?? (user ? getPrimaryAddress(user) : null)
  const hasAddress    = !!(primaryAddr?.address || user?.address)

  // Último pedido no cancelado que tenga al menos un producto con productoId (para poder mapearlo al catálogo)
  const lastOrder = orders.find(
    (o) => o.status !== 'cancelado' && o.products.some((p) => p.productoId),
  )

  const { permission, request, notify } = usePushNotification()

  // Detectar cuando un pedido cambia a en_camino para notificar
  const initializedRef  = useRef(false)
  const prevStatusesRef = useRef<Record<string, OrderStatus>>({})
  useEffect(() => {
    if (orders.length === 0) return
    if (!initializedRef.current) {
      orders.forEach((o) => { prevStatusesRef.current[o.id] = o.status })
      initializedRef.current = true
      return
    }
    orders.forEach((o) => {
      const prev = prevStatusesRef.current[o.id]
      if (prev && prev !== o.status && o.status === 'en_camino') {
        notify('Tu pedido está en camino 🚛', summarizeProducts(o.products))
      }
      prevStatusesRef.current[o.id] = o.status
    })
  }, [orders, notify])

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold">
            Hola, {(user?.nombreContacto || user?.nombre)?.split(' ')[0] ?? 'amigo'} 👋
          </h1>
          {multiSucursal && selectedAddress ? (
            <div className="flex items-center gap-2 mt-1">
              <p className="text-accent text-sm font-medium">📍 {selectedAddress.nombre}</p>
              <Link to="/sucursal" className="text-xs text-muted hover:text-white transition-colors">
                Cambiar →
              </Link>
            </div>
          ) : (
            <p className="text-muted text-sm mt-1">Gestión de pedidos de hielo</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Pedidos activos"    value={active.length}    color="text-accent" />
          <StatCard label="Pedidos entregados" value={delivered.length} color="text-success" />
        </div>

        {permission === 'default' && (
          <div className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Activar notificaciones</p>
              <p className="text-xs text-muted mt-0.5">Avisamos cuando tu pedido sale y cuando el camión está cerca</p>
            </div>
            <button
              onClick={() => request(user?.uid ? (sub) => savePushSubscription(user.uid, sub) : undefined)}
              className="shrink-0 bg-accent text-bg text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-accent/90 transition-colors"
            >
              Activar
            </button>
          </div>
        )}

        {enCaminoOrder && (
          <TruckTracker
            order={enCaminoOrder}
            clientEmail={user?.email ?? ''}
            clientNombre={(user?.nombreContacto || user?.nombre || '').split(' ')[0] || 'Cliente'}
            onNearby={() => notify('Tu pedido llega en minutos ⏱️', 'El camión está a menos de 500 metros')}
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

        <div className="space-y-2">
          <Link
            to="/nuevo-pedido"
            className="flex items-center justify-center gap-2 w-full bg-accent text-bg font-semibold py-3 rounded-xl hover:bg-accent/90 transition-colors text-sm"
          >
            + Hacer nuevo pedido
          </Link>

          {lastOrder && (
            <button
              onClick={() => navigate('/nuevo-pedido', { state: { repeatOrder: lastOrder } })}
              className="w-full flex items-center justify-between gap-3 bg-surface border border-border hover:border-accent/50 rounded-xl px-4 py-3 text-sm transition-colors group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-muted group-hover:text-accent transition-colors shrink-0">↩</span>
                <div className="text-left min-w-0">
                  <p className="text-xs text-muted">Repetir último pedido</p>
                  <p className="text-white truncate text-sm">{summarizeProducts(lastOrder.products)}</p>
                </div>
              </div>
              <span className="text-muted text-xs shrink-0 group-hover:text-accent transition-colors">→</span>
            </button>
          )}
        </div>

        <RecurrenteCard user={user} />

        <ClientWeather address={selectedAddress?.address || primaryAddr?.address || user?.address || ''} isLoaded={isLoaded} />

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
  onNearby,
}: {
  order:        Order
  clientEmail:  string
  clientNombre: string
  onNearby:     () => void
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
      onNearby()
    }
  }, [distance, clientEmail, clientNombre, order.products, onNearby])

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
                  url:        '/camion-rolito.png',
                  scaledSize: new google.maps.Size(90, 62),
                  anchor:     new google.maps.Point(45, 31),
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

// ── ClientWeather ─────────────────────────────────────────────────────────────

function tempColor(t: number): string {
  if (t >= 35) return '#ef4444'
  if (t >= 30) return '#f97316'
  if (t >= 25) return '#eab308'
  if (t >= 20) return '#84cc16'
  return '#60a5fa'
}

function ClientWeather({ address, isLoaded }: { address: string; isLoaded: boolean }) {
  const [coords, setCoords]   = useState<{ lat: number; lng: number } | null>(null)
  const [days,   setDays]     = useState<DayWeather[]>([])
  const [loading, setLoading] = useState(true)
  const [open,    setOpen]    = useState(false)
  const geocodedRef           = useRef(false)

  // Geocodificar la dirección del cliente (una sola vez)
  useEffect(() => {
    if (geocodedRef.current) return
    if (isLoaded && address) {
      geocodedRef.current = true
      new google.maps.Geocoder().geocode({ address }, (results, status) => {
        if (status === 'OK' && results?.[0]) {
          const loc = results[0].geometry.location
          setCoords({ lat: loc.lat(), lng: loc.lng() })
        } else {
          setCoords(null) // usa default BA
        }
      })
    } else if (!address) {
      setCoords(null)
    }
  }, [isLoaded, address])

  // Traer pronóstico con las coordenadas resueltas
  useEffect(() => {
    setLoading(true)
    getForecast(coords?.lat, coords?.lng)
      .then(setDays)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [coords])

  const today = days[0]

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* Header siempre visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          {loading ? (
            <span className="text-muted text-sm">Cargando clima...</span>
          ) : today ? (
            <>
              <span className="text-2xl leading-none">{today.emoji}</span>
              <div className="text-left">
                <p className="text-sm font-medium leading-tight">
                  Hoy{' '}
                  <span style={{ color: tempColor(today.tempMax) }} className="font-bold">
                    {today.tempMax}°
                  </span>
                  <span className="text-muted font-normal"> / {today.tempMin}°</span>
                  {today.rain > 0 && (
                    <span className="text-blue-400 text-xs ml-2">🌧️ {today.rain}mm</span>
                  )}
                </p>
                <p className="text-xs text-muted">{today.label}</p>
              </div>
            </>
          ) : null}
        </div>
        <span className="text-muted text-xs shrink-0 ml-2">{open ? '▲' : '▼ Semana'}</span>
      </button>

      {/* Pronóstico 7 días desplegable */}
      {open && days.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((d, i) => {
              const date = new Date(d.date + 'T12:00:00')
              return (
                <div
                  key={d.date}
                  className={`flex flex-col items-center gap-1 rounded-xl p-3 min-w-[68px] border shrink-0 ${
                    i === 0 ? 'bg-accent/10 border-accent/30' : 'bg-bg border-border/60'
                  }`}
                >
                  <p className="text-xs text-muted font-medium">
                    {i === 0 ? 'Hoy' : date.toLocaleDateString('es-AR', { weekday: 'short' })}
                  </p>
                  <p className="text-xl leading-none">{d.emoji}</p>
                  <p className="font-bold text-sm" style={{ color: tempColor(d.tempMax) }}>
                    {d.tempMax}°
                  </p>
                  <p className="text-xs text-muted">{d.tempMin}°</p>
                  {d.rain > 0 && (
                    <p className="text-xs text-blue-400">{d.rain}mm</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <p className="text-muted text-sm">{label}</p>
      <p className={`text-4xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  )
}

// ── RecurrenteCard ────────────────────────────────────────────────────────────

function RecurrenteCard({ user }: { user: import('../../types').UserProfile | null }) {
  const { recurrente, save } = useRecurrente(user?.uid)
  const { catalogo }         = useCatalogo()
  const [modal,      setModal]      = useState(false)
  const [diasSel,    setDiasSel]    = useState<number[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [saving,     setSaving]     = useState(false)

  const primaryAddr = user ? getPrimaryAddress(user) : null

  const openModal = () => {
    setDiasSel(recurrente?.diasSemana ?? [])
    const q: Record<string, number> = {}
    recurrente?.products.forEach((p) => { if (p.productoId) q[p.productoId] = p.quantity })
    setQuantities(q)
    setModal(true)
  }

  const handleSave = async (activo: boolean) => {
    if (!user) return
    const products: OrderProduct[] = catalogo
      .filter((p) => (quantities[p.id] ?? 0) > 0)
      .map((p) => ({ name: p.nombre, quantity: quantities[p.id], productoId: p.id }))

    setSaving(true)
    await save({
      clientId:     user.uid,
      clientEmail:  user.email,
      clientName:   user.razonSocial || user.nombre || '',
      clientAddress: primaryAddr?.address || user.address || '',
      clientPhone:  user.telefono || user.phone || '',
      diasSemana:   diasSel,
      products,
      activo,
    })
    setSaving(false)
    setModal(false)
  }

  if (recurrente === undefined) return null

  const diasLabels = DIAS_SEMANA.filter((_, i) => recurrente?.diasSemana?.includes(i))

  return (
    <>
      <div className="bg-surface border border-border rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-semibold">Pedido automático</p>
              {recurrente && (
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                  recurrente.activo
                    ? 'bg-success/15 text-success border-success/30'
                    : 'bg-muted/15 text-muted border-muted/30'
                }`}>
                  {recurrente.activo ? 'Activo' : 'Pausado'}
                </span>
              )}
            </div>
            {recurrente ? (
              <>
                <p className="text-xs text-muted">{diasLabels.join(' · ')}</p>
                <p className="text-xs text-white mt-0.5 truncate">{summarizeProducts(recurrente.products)}</p>
              </>
            ) : (
              <p className="text-xs text-muted">Recibí tus productos los mismos días sin tener que pedir cada vez</p>
            )}
          </div>
          <button
            onClick={openModal}
            className="shrink-0 text-xs text-accent hover:underline"
          >
            {recurrente ? 'Editar' : 'Configurar →'}
          </button>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Pedido automático">
        <div className="space-y-5">
          <div>
            <p className="text-xs text-muted mb-2">Días de entrega</p>
            <div className="flex gap-2 flex-wrap">
              {DIAS_SEMANA.map((dia, i) => (
                <button
                  key={dia}
                  onClick={() => setDiasSel((d) =>
                    d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()
                  )}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    diasSel.includes(i)
                      ? 'bg-accent/20 border-accent text-accent'
                      : 'border-border text-muted hover:border-accent/50'
                  }`}
                >
                  {dia}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-muted mb-2">Productos</p>
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {catalogo.map((p) => {
                const qty = quantities[p.id] ?? 0
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 bg-bg border border-border rounded-xl px-3 py-2">
                    <p className="text-sm flex-1 truncate">{p.nombre}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setQuantities((q) => ({ ...q, [p.id]: Math.max(0, (q[p.id] ?? 0) - 1) }))}
                        disabled={qty === 0}
                        className="w-7 h-7 rounded-full border border-border hover:border-accent transition-colors disabled:opacity-30 flex items-center justify-center text-sm"
                      >−</button>
                      <span className="w-7 text-center font-bold text-sm">{qty || '0'}</span>
                      <button
                        onClick={() => setQuantities((q) => ({ ...q, [p.id]: (q[p.id] ?? 0) + 1 }))}
                        className="w-7 h-7 rounded-full border border-border hover:border-accent transition-colors flex items-center justify-center text-sm"
                      >+</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          {recurrente?.activo && (
            <Button variant="outline" onClick={() => handleSave(false)} loading={saving} className="text-sm">
              Pausar
            </Button>
          )}
          <Button
            onClick={() => handleSave(true)}
            loading={saving}
            disabled={diasSel.length === 0 || !catalogo.some((p) => (quantities[p.id] ?? 0) > 0)}
            className="flex-1 text-sm"
          >
            Guardar
          </Button>
        </div>
      </Modal>
    </>
  )
}

const MOTIVOS_CANCEL = [
  'Ya no lo necesito',
  'Me equivoqué en el pedido',
  'Cambio de fecha',
  'Otro motivo',
]

function OrderRow({ order }: { order: Order }) {
  const [modal,   setModal]   = useState(false)
  const [motivo,  setMotivo]  = useState('')
  const [loading, setLoading] = useState(false)

  const canCancel = order.status === 'pendiente'

  const handleCancel = useCallback(async () => {
    if (!motivo) return
    setLoading(true)
    try {
      await cancelOrder(order.id, motivo)
      setModal(false)
    } finally {
      setLoading(false)
    }
  }, [order.id, motivo])

  return (
    <>
      <div className="bg-surface border border-border rounded-xl p-4 flex justify-between items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{summarizeProducts(order.products)}</p>
          <p className="text-muted text-xs mt-1">Entrega: {formatShortDate(order.date)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canCancel && (
            <button
              onClick={() => { setMotivo(''); setModal(true) }}
              className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-400/50 px-2.5 py-1 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          )}
          <Badge status={order.status} />
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Cancelar pedido">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            ¿Por qué querés cancelar este pedido?
          </p>
          <div className="space-y-2">
            {MOTIVOS_CANCEL.map((m) => (
              <button
                key={m}
                onClick={() => setMotivo(m)}
                className={`w-full text-left text-sm px-4 py-3 rounded-xl border transition-colors ${
                  motivo === m
                    ? 'bg-red-500/10 border-red-500/50 text-red-400'
                    : 'border-border text-muted hover:border-border/70 hover:text-white'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={() => setModal(false)} className="flex-1 text-sm">
              Volver
            </Button>
            <Button
              onClick={handleCancel}
              loading={loading}
              disabled={!motivo}
              className="flex-1 text-sm !bg-red-600 hover:!bg-red-500"
            >
              Confirmar cancelación
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
