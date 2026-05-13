import { useState, useEffect, useRef, ChangeEvent, KeyboardEvent } from 'react'
import { GoogleMap, Marker, InfoWindow } from '@react-google-maps/api'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { subscribeAllActiveDrivers, ActiveDriver } from '../../services/locationService'
import Navbar from '../../components/layout/Navbar'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAllOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { useNotificationEmails } from '../../hooks/useNotificationEmails'
import { useAuth } from '../../context/AuthContext'
import Modal from '../../components/ui/Modal'
import { auth } from '../../services/firebase'
import { updateOrderStatus, assignDriver, updateOrderAddress } from '../../services/orderService'
import { cleanupTestData, CleanupResult } from '../../services/cleanupService'
import { useNotifyEnCamino } from '../../hooks/useNotifications'
import MetricsDashboard from './MetricsDashboard'
import { ALL_STATUSES, STATUS_FLOW, STATUS_LABELS } from '../../utils/constants'
import { formatShortDate, summarizeProducts } from '../../utils/helpers'
import { generateHojaDeRuta } from '../../utils/pdf'
import { Order, OrderStatus, UserProfile } from '../../types'
import { Link } from 'react-router-dom'

// ── Map constants ─────────────────────────────────────────────────────────────

const MAP_CONTAINER: React.CSSProperties = { width: '100%', height: '100%' }
const BA_DEFAULT = { lat: -34.6037, lng: -58.3816 }
const STALE_MS   = 20 * 60 * 1000

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry',           stylers: [{ color: '#0A1628' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A1628' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#74a0c8' }] },
  { featureType: 'road',         elementType: 'geometry', stylers: [{ color: '#1E3A5F' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#163868' }] },
  { featureType: 'water',        elementType: 'geometry', stylers: [{ color: '#05101e' }] },
  { featureType: 'poi',          elementType: 'geometry', stylers: [{ color: '#0e1f38' }] },
  { featureType: 'transit',      elementType: 'geometry', stylers: [{ color: '#1E3A5F' }] },
]

function makeDriverIcon(pending: number, isStale: boolean) {
  const fill = isStale ? '#F97316' : '#00C2FF'
  const svg  = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">` +
    `<circle cx="20" cy="20" r="18" fill="${fill}" stroke="white" stroke-width="2"/>` +
    `<text x="20" y="25" font-size="16" font-weight="bold" text-anchor="middle" fill="white">${pending}</text>` +
    `</svg>`,
  )
  return {
    url:        `data:image/svg+xml;charset=UTF-8,${svg}`,
    scaledSize: new google.maps.Size(40, 40),
    anchor:     new google.maps.Point(20, 20),
  }
}

// ── LiveMapSection ─────────────────────────────────────────────────────────────

function LiveMapSection({ orders }: { orders: Order[] }) {
  const { isLoaded }                  = useGoogleMapsLoader()
  const [open, setOpen]               = useState(false)
  const [drivers, setDrivers]         = useState<ActiveDriver[]>([])
  const [selected, setSelected]       = useState<string | null>(null)
  const mapRef                        = useRef<google.maps.Map | null>(null)

  useEffect(() => subscribeAllActiveDrivers(setDrivers), [])

  const now = Date.now()

  const pendingByDriver = orders.reduce<Record<string, number>>((acc, o) => {
    if (o.driverId && !['entregado', 'cancelado'].includes(o.status)) {
      acc[o.driverId] = (acc[o.driverId] ?? 0) + 1
    }
    return acc
  }, {})

  // Auto-fit when map opens and drivers are loaded
  useEffect(() => {
    if (!open || !mapRef.current || drivers.length === 0) return
    if (drivers.length === 1) {
      mapRef.current.panTo({ lat: drivers[0].lat, lng: drivers[0].lng })
      mapRef.current.setZoom(14)
      return
    }
    const bounds = new google.maps.LatLngBounds()
    drivers.forEach((d) => bounds.extend({ lat: d.lat, lng: d.lng }))
    mapRef.current.fitBounds(bounds, 80)
  }, [open, drivers])

  const staleDrivers = drivers.filter(
    (d) => d.timestamp && now - d.timestamp > STALE_MS,
  )

  return (
    <section className="space-y-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex justify-between items-center bg-surface border border-border rounded-xl px-4 py-3 text-left hover:border-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {drivers.length > 0 && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${drivers.length > 0 ? 'bg-accent' : 'bg-muted'}`} />
          </span>
          <span className="font-semibold text-sm">
            Mapa en vivo
            {drivers.length > 0 && (
              <span className="ml-2 text-accent">{drivers.length} activo{drivers.length !== 1 ? 's' : ''}</span>
            )}
          </span>
        </div>
        <span className="text-muted text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="space-y-3">
          {staleDrivers.length > 0 && (
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 text-sm text-orange-400">
              ⚠ {staleDrivers.map((d) => d.nombreChofer || d.email).join(', ')} sin movimiento &gt; 20 min
            </div>
          )}

          <div className="rounded-xl overflow-hidden border border-border" style={{ height: '320px' }}>
            {isLoaded ? (
              <GoogleMap
                mapContainerStyle={MAP_CONTAINER}
                center={BA_DEFAULT}
                zoom={12}
                options={{
                  disableDefaultUI: true,
                  zoomControl:      true,
                  gestureHandling:  'cooperative',
                  styles:           DARK_MAP_STYLES,
                }}
                onLoad={(m) => { mapRef.current = m }}
              >
                {drivers.map((driver) => {
                  const isStale = !!(driver.timestamp && now - driver.timestamp > STALE_MS)
                  const pending = pendingByDriver[driver.email] ?? 0
                  return (
                    <Marker
                      key={driver.email}
                      position={{ lat: driver.lat, lng: driver.lng }}
                      icon={makeDriverIcon(pending, isStale)}
                      onClick={() => setSelected((s) => (s === driver.email ? null : driver.email))}
                    >
                      {selected === driver.email && (
                        <InfoWindow onCloseClick={() => setSelected(null)}>
                          <div style={{ color: '#111', minWidth: '140px', fontSize: '13px' }}>
                            <p style={{ margin: '0 0 4px', fontWeight: 700 }}>
                              {driver.nombreChofer || driver.email}
                            </p>
                            <p style={{ margin: 0 }}>{pending} pendiente{pending !== 1 ? 's' : ''}</p>
                            {isStale && (
                              <p style={{ margin: '4px 0 0', color: '#F97316', fontWeight: 600 }}>
                                ⚠ Sin movimiento &gt;20 min
                              </p>
                            )}
                            {driver.telefonoChofer && (
                              <a
                                href={`tel:${driver.telefonoChofer}`}
                                style={{ display: 'block', marginTop: '6px', color: '#0066cc' }}
                              >
                                📞 {driver.telefonoChofer}
                              </a>
                            )}
                          </div>
                        </InfoWindow>
                      )}
                    </Marker>
                  )
                })}
              </GoogleMap>
            ) : (
              <div className="w-full h-full bg-surface animate-pulse" />
            )}
          </div>

          {drivers.length === 0 ? (
            <p className="text-muted text-sm text-center py-2">No hay choferes activos en este momento</p>
          ) : (
            <div className="grid gap-2">
              {drivers.map((driver) => {
                const isStale = !!(driver.timestamp && now - driver.timestamp > STALE_MS)
                const pending = pendingByDriver[driver.email] ?? 0
                return (
                  <div
                    key={driver.email}
                    className={`bg-surface border rounded-xl px-4 py-3 flex justify-between items-center gap-3 ${
                      isStale ? 'border-orange-500/40' : 'border-border'
                    }`}
                  >
                    <div>
                      <p className="font-medium text-sm">{driver.nombreChofer || driver.email}</p>
                      {driver.telefonoChofer && (
                        <a href={`tel:${driver.telefonoChofer}`} className="text-accent text-xs hover:underline">
                          {driver.telefonoChofer}
                        </a>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-accent font-bold text-lg leading-none">{pending}</p>
                      <p className="text-muted text-xs mt-0.5">pendientes</p>
                      {isStale && (
                        <p className="text-orange-400 text-xs mt-1">⚠ &gt;20 min</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default function AdminDashboard() {
  const { orders, loading } = useAllOrders()
  const { user }            = useAuth()
  const choferes            = useChoferes()
  const notifEmails         = useNotificationEmails()
  const [search, setSearch]         = useState('')
  const [filter, setFilter]         = useState<OrderStatus | 'all'>('all')
  const [dateFilter, setDateFilter] = useState('')
  const [cleanupModal,  setCleanupModal]  = useState(false)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupResult,  setCleanupResult]  = useState<CleanupResult | null>(null)
  const [pdfDriver,   setPdfDriver]   = useState('')
  const [pdfLoading,  setPdfLoading]  = useState(false)

  // Usa el email del token de Firebase Auth — no depende del doc de Firestore
  const isSuperAdmin = auth.currentUser?.email === 'pontieroariel@gmail.com'

  const handleCleanup = async () => {
    if (!user?.uid) return
    setCleanupLoading(true)
    try {
      const result = await cleanupTestData(user.uid)
      setCleanupResult(result)
    } finally {
      setCleanupLoading(false)
    }
  }

  // Choferes con pedidos activos hoy sin camión confirmado hoy
  const hoy = new Date().toLocaleDateString('es-AR')
  const choferesSinCamionHoy = choferes.choferes.filter((c) => {
    const tieneOrden = orders.some(
      (o) => o.driverId === c.email && !['entregado', 'cancelado'].includes(o.status),
    )
    if (!tieneOrden) return false
    if (!c.camionId) return true
    if (!c.camionFechaAsignacion?.toDate) return true
    return c.camionFechaAsignacion.toDate().toLocaleDateString('es-AR') !== hoy
  })

  const filtered = orders.filter((o) => {
    const matchStatus = filter === 'all' || o.status === filter
    const matchDate   = !dateFilter ||
      o.date?.toDate?.().toISOString().split('T')[0] === dateFilter
    const q = search.toLowerCase()
    const matchSearch = !q ||
      o.clientName?.toLowerCase().includes(q) ||
      o.clientAddress?.toLowerCase().includes(q) ||
      o.products?.some((p) => p.name.toLowerCase().includes(q))
    return matchStatus && matchDate && matchSearch
  })

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Panel Admin</h1>
            <p className="text-muted text-sm">Gestión de pedidos y logística</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <NotificationEmailManager notifEmails={notifEmails} />
          </div>
        </div>

        {/* Alerta flota: choferes con pedidos sin camión confirmado hoy */}
        {choferesSinCamionHoy.length > 0 && (
          <Link
            to="/admin/flota"
            className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 hover:bg-orange-500/15 transition-colors"
          >
            <span className="text-orange-400 text-xl shrink-0">🚛</span>
            <div className="flex-1">
              <p className="text-orange-400 font-semibold text-sm">
                {choferesSinCamionHoy.length} chofer{choferesSinCamionHoy.length !== 1 ? 'es' : ''} sin camión confirmado para hoy
              </p>
              <p className="text-orange-400/70 text-xs mt-0.5">
                {choferesSinCamionHoy.map((c) => c.nombreContacto || c.nombre).join(', ')} · Tocá para asignar →
              </p>
            </div>
          </Link>
        )}

        {isSuperAdmin && (
          <>
            <button
              onClick={() => { setCleanupResult(null); setCleanupModal(true) }}
              className="w-full text-left bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Limpiar datos de prueba →
            </button>

            <Modal
            open={cleanupModal}
            onClose={() => { if (!cleanupLoading) setCleanupModal(false) }}
            title="Limpiar datos de prueba"
          >
            {cleanupResult ? (
              <div className="space-y-4">
                <div className="bg-success/10 border border-success/30 rounded-xl p-4 space-y-1 text-sm">
                  <p className="font-semibold text-success mb-2">Limpieza completada</p>
                  <p className="text-muted">Usuarios eliminados: <span className="text-white font-medium">{cleanupResult.users}</span></p>
                  <p className="text-muted">Pedidos eliminados: <span className="text-white font-medium">{cleanupResult.orders}</span></p>
                  <p className="text-muted">Ubicaciones eliminadas: <span className="text-white font-medium">{cleanupResult.ubicaciones}</span></p>
                  {cleanupResult.clientes > 0 && (
                    <p className="text-muted">Clientes eliminados: <span className="text-white font-medium">{cleanupResult.clientes}</span></p>
                  )}
                </div>
                <Button className="w-full" onClick={() => setCleanupModal(false)}>
                  Cerrar
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm space-y-2">
                  <p className="text-red-400 font-semibold">Esta acción no se puede deshacer.</p>
                  <p className="text-muted">Se borrarán todos los usuarios de prueba (excepto tu cuenta), todos los pedidos, y todas las ubicaciones.</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setCleanupModal(false)}
                    className="flex-1"
                    disabled={cleanupLoading}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="danger"
                    onClick={handleCleanup}
                    loading={cleanupLoading}
                    className="flex-1"
                  >
                    Sí, limpiar todo
                  </Button>
                </div>
              </div>
            )}
          </Modal>
          </>
        )}

        <MetricsDashboard orders={orders} />

        <LiveMapSection orders={orders} />

        <ResumenCargaPorChofer orders={orders} choferes={choferes.choferes} />

        {/* Exportar hoja de ruta */}
        <div className="bg-surface border border-border rounded-xl p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-300 shrink-0">📄 Hoja de ruta</span>
          <select
            value={pdfDriver}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setPdfDriver(e.target.value)}
            className="bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent flex-1 min-w-40"
          >
            <option value="">— Seleccionar chofer —</option>
            {choferes.choferes.map((c) => (
              <option key={c.uid} value={c.email ?? ''}>
                {c.nombreContacto || c.nombre || c.email}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            disabled={!pdfDriver || pdfLoading}
            loading={pdfLoading}
            className="text-sm shrink-0"
            onClick={async () => {
              setPdfLoading(true)
              const driverOrders = orders.filter(
                (o) => o.driverId === pdfDriver && !['entregado', 'cancelado'].includes(o.status),
              )
              const chofer = choferes.choferes.find((c) => c.email === pdfDriver)
              const name   = chofer?.nombreContacto || chofer?.nombre || pdfDriver
              await generateHojaDeRuta(driverOrders, name)
              setPdfLoading(false)
            }}
          >
            Exportar PDF
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <input
              value={search}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, dirección o producto..."
              className="bg-surface border border-border rounded-lg px-3 py-2 text-white placeholder-muted text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="date"
              value={dateFilter}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDateFilter(e.target.value)}
              className="bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {(search || dateFilter) && (
              <button
                onClick={() => { setSearch(''); setDateFilter('') }}
                className="text-sm text-muted hover:text-white px-3 py-2"
              >
                Limpiar ✕
              </button>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            {(['all', ...ALL_STATUSES] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  filter === s
                    ? 'bg-accent text-bg border-accent'
                    : 'border-border text-muted hover:border-accent hover:text-white'
                }`}
              >
                {s === 'all'
                  ? `Todos (${orders.length})`
                  : `${STATUS_LABELS[s]} (${orders.filter((o) => o.status === s).length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-8 text-center">
              <p className="text-muted text-sm">No hay pedidos con estos filtros</p>
            </div>
          ) : (
            filtered.map((o) => (
              <AdminOrderCard key={o.id} order={o} choferes={choferes.choferes} />
            ))
          )}
        </div>
      </main>
    </>
  )
}

function ResumenCargaPorChofer({
  orders,
  choferes,
}: {
  orders:   Order[]
  choferes: UserProfile[]
}) {
  const [open, setOpen] = useState(true)

  const active = orders.filter((o) => !['entregado', 'cancelado'].includes(o.status) && o.driverId)

  // Agrupar totales por chofer
  const byDriver: Record<string, { nombre: string; totals: Record<string, number>; paradas: number }> = {}
  active.forEach((o) => {
    const id = o.driverId!
    if (!byDriver[id]) {
      const chofer = choferes.find((c) => c.email === id)
      byDriver[id] = {
        nombre:  chofer?.nombreContacto || chofer?.nombre || id,
        totals:  {},
        paradas: 0,
      }
    }
    byDriver[id].paradas++
    o.products.forEach((p) => {
      byDriver[id].totals[p.name] = (byDriver[id].totals[p.name] ?? 0) + p.quantity
    })
  })

  const drivers = Object.entries(byDriver)

  // Sin asignar
  const sinAsignar = orders.filter(
    (o) => !['entregado', 'cancelado'].includes(o.status) && !o.driverId,
  )

  if (drivers.length === 0 && sinAsignar.length === 0) return null

  return (
    <section className="space-y-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex justify-between items-center bg-surface border border-border rounded-xl px-4 py-3 text-left hover:border-accent/50 transition-colors"
      >
        <span className="font-semibold text-sm">Resumen de carga del día</span>
        <span className="text-muted text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="space-y-3">
          {sinAsignar.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 text-sm text-yellow-400">
              ⚠ {sinAsignar.length} pedido{sinAsignar.length !== 1 ? 's' : ''} sin chofer asignado
            </div>
          )}

          {drivers.length === 0 ? (
            <p className="text-muted text-sm text-center py-2">No hay pedidos activos asignados</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {drivers.map(([email, { nombre, totals, paradas }]) => {
                const items = Object.entries(totals).sort((a, b) => b[1] - a[1])
                const totalUnidades = items.reduce((acc, [, q]) => acc + q, 0)
                return (
                  <div key={email} className="bg-surface border border-border rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-sm">{nombre}</p>
                        <p className="text-xs text-muted mt-0.5">{paradas} parada{paradas !== 1 ? 's' : ''}</p>
                      </div>
                      <span className="text-accent font-bold text-lg leading-none">{totalUnidades}</span>
                    </div>
                    <div className="space-y-1.5 pt-2 border-t border-border/60">
                      {items.map(([nombre, qty]) => (
                        <div key={nombre} className="flex justify-between items-center text-sm">
                          <span className="text-muted truncate flex-1 mr-2">{nombre}</span>
                          <span className="font-bold text-white shrink-0">{qty} u</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function AdminOrderCard({ order, choferes }: { order: Order; choferes: UserProfile[] }) {
  const [statusLoading, setStatusLoading] = useState(false)
  const [editingAddress, setEditingAddress] = useState(false)
  const [newAddress, setNewAddress]         = useState(order.clientAddress)
  const notifyEnCaminoMutation = useNotifyEnCamino()

  const getNextStatus = (): OrderStatus | null => {
    const idx = STATUS_FLOW.indexOf(order.status)
    return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null
  }

  const handleStatus = async (newStatus: string) => {
    setStatusLoading(true)
    await updateOrderStatus(order.id, newStatus)
    if (newStatus === 'en_camino' && order.clientEmail) {
      notifyEnCaminoMutation.mutate({
        email:    order.clientEmail,
        nombre:   (order.clientName || '').split(' ')[0] || 'Cliente',
        products: order.products,
      })
    }
    setStatusLoading(false)
  }

  const handleDriver = async (e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value || null
    await assignDriver(order.id, val)
  }

  const handleSaveAddress = async () => {
    await updateOrderAddress(order.id, newAddress)
    setEditingAddress(false)
  }

  const next = getNextStatus()

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap justify-between items-start gap-2">
        <div>
          <p className="font-semibold">{order.clientName}</p>
          <p className="text-muted text-xs">{order.clientPhone || 'Sin teléfono'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge status={order.status} />
          <span className="text-xs text-muted">{formatShortDate(order.date)}</span>
        </div>
      </div>

      <div className="text-sm">
        {editingAddress ? (
          <div className="flex gap-2">
            <input
              value={newAddress}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewAddress(e.target.value)}
              className="bg-bg border border-border rounded px-2 py-1 text-white text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button onClick={handleSaveAddress} className="text-success text-xs hover:underline">Guardar</button>
            <button onClick={() => setEditingAddress(false)} className="text-muted text-xs hover:underline">Cancelar</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-muted text-xs">📍 {order.clientAddress}</p>
            <button
              onClick={() => setEditingAddress(true)}
              className="text-accent text-xs hover:underline"
            >
              Editar
            </button>
          </div>
        )}
      </div>

      <p className="text-sm text-white">{summarizeProducts(order.products)}</p>

      {order.notes && (
        <p className="text-xs text-muted italic">"{order.notes}"</p>
      )}

      <div className="flex flex-wrap gap-2 items-center pt-3 border-t border-border">
        {['entregado', 'cancelado'].includes(order.status) ? (
          <span className="text-xs text-muted flex-1 min-w-40">
            Chofer: <span className="text-white">{order.driverId ?? '—'}</span>
          </span>
        ) : (
          <select
            value={order.driverId ?? ''}
            onChange={handleDriver}
            className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent flex-1 min-w-40"
          >
            <option value="">Sin chofer asignado</option>
            {choferes.map((c) => (
              <option key={c.uid} value={c.email}>{c.nombre || c.email}</option>
            ))}
          </select>
        )}

        {next && (
          <Button
            onClick={() => handleStatus(next)}
            loading={statusLoading}
            className="text-xs py-1.5 px-3"
          >
            → {STATUS_LABELS[next]}
          </Button>
        )}

        {!['cancelado', 'entregado'].includes(order.status) && (
          <Button
            variant="danger"
            onClick={() => handleStatus('cancelado')}
            disabled={statusLoading}
            className="text-xs py-1.5 px-3"
          >
            Cancelar
          </Button>
        )}
      </div>
    </div>
  )
}

type UseNotificationEmailsReturn = ReturnType<typeof useNotificationEmails>

function NotificationEmailManager({ notifEmails }: { notifEmails: UseNotificationEmailsReturn }) {
  const { emails, addEmail, removeEmail } = notifEmails
  const [open,  setOpen]  = useState(false)
  const [email, setEmail] = useState('')

  const handleAdd = async () => {
    if (!email.trim()) return
    await addEmail(email)
    setEmail('')
  }

  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((o) => !o)} className="text-sm">
        Notificaciones ({emails.length}) ▾
      </Button>

      {open && (
        <div className="absolute right-0 top-10 bg-surface border border-border rounded-xl p-4 z-50 w-80 shadow-2xl">
          <h3 className="font-semibold mb-1 text-sm">Emails de notificación</h3>
          <p className="text-muted text-xs mb-3">
            Reciben un email cuando llega un pedido nuevo.
          </p>

          {emails.length === 0 ? (
            <p className="text-muted text-xs mb-3">Sin emails configurados</p>
          ) : (
            <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
              {emails.map((e) => (
                <div key={e} className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-0">
                  <span className="text-sm text-muted truncate flex-1">{e}</span>
                  <button
                    onClick={() => removeEmail(e)}
                    className="text-red-400 text-xs hover:underline ml-2 shrink-0"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') handleAdd() }}
              placeholder="admin@empresa.com"
              className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-white flex-1 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button onClick={handleAdd} className="text-xs py-1.5 px-3">
              + Agregar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

