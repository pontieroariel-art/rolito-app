import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { GoogleMap, Marker, InfoWindow } from '@react-google-maps/api'
import { FileText, Plus, AlertTriangle, CheckCircle } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import ImportarPedidoModal from '../../components/admin/ImportarPedidoModal'
import PedidoManualModal from '../../components/admin/PedidoManualModal'
import { useAllOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { useFlota } from '../../hooks/useFlota'
import { useCatalogo } from '../../hooks/useCatalogo'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { assignDriver } from '../../services/orderService'
import { calcPallets, summarizeProducts } from '../../utils/helpers'
import { Order, UserProfile, Camion, CatalogProducto } from '../../types'

// ── Constantes ────────────────────────────────────────────────────────────────

const DRIVER_COLORS = ['#00C2FF', '#FF6B6B', '#4ECDC4', '#A8E6CF', '#FFE66D', '#C084FC', '#F97316', '#34D399']
const UNASSIGNED_COLOR = '#F59E0B'

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry',           stylers: [{ color: '#0A1628' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A1628' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#74a0c8' }] },
  { featureType: 'road',         elementType: 'geometry', stylers: [{ color: '#1E3A5F' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#163868' }] },
  { featureType: 'water',        elementType: 'geometry', stylers: [{ color: '#05101e' }] },
  { featureType: 'poi',     stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateToStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function next7Days(): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() + i)
    return d
  })
}

function orderDateStr(o: Order): string {
  if (!o.date?.toDate) return ''
  return dateToStr(o.date.toDate())
}

function dayLabel(d: Date, idx: number): string {
  if (idx === 0) return 'Hoy'
  if (idx === 1) return 'Mañana'
  return d.toLocaleDateString('es-AR', { weekday: 'short' })
}

function driverColor(email: string, choferes: UserProfile[]): string {
  const idx = choferes.findIndex((c) => c.email === email)
  return idx >= 0 ? DRIVER_COLORS[idx % DRIVER_COLORS.length] : UNASSIGNED_COLOR
}

function makePin(fill: string, label: string) {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38">` +
    `<path d="M15 0C6.7 0 0 6.7 0 15c0 10.3 15 23 15 23s15-12.7 15-23C30 6.7 23.3 0 15 0z" fill="${fill}"/>` +
    `<text x="15" y="20" font-size="12" font-weight="bold" text-anchor="middle" fill="white" font-family="sans-serif">${label}</text>` +
    `</svg>`,
  )
  return {
    url:        `data:image/svg+xml;charset=UTF-8,${svg}`,
    scaledSize: new google.maps.Size(30, 38),
    anchor:     new google.maps.Point(15, 38),
  }
}

// ── CapacityBar ───────────────────────────────────────────────────────────────

function CapacityBar({ used, total }: { used: number; total?: number }) {
  const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 })
  if (!total) return used > 0 ? <p className="text-xs text-gray-500">{fmt(used)} pallets</p> : null
  const pct      = Math.min((used / total) * 100, 100)
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-accent'
  const txtColor = pct >= 90 ? 'text-red-600' : pct >= 70 ? 'text-amber-600' : 'text-accent'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">{fmt(used)} / {total} pallets</span>
        <span className={`font-semibold ${txtColor}`}>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── DayMap ────────────────────────────────────────────────────────────────────

interface MapMarker { id: string; lat: number; lng: number; label: string; color: string; title: string; subtitle: string }

function DayMap({ orders, choferes }: { orders: Order[]; choferes: UserProfile[] }) {
  const { isLoaded }                      = useGoogleMapsLoader()
  const mapRef                             = useRef<google.maps.Map | null>(null)
  const geocacheRef                        = useRef<Map<string, { lat: number; lng: number } | null>>(new Map())
  const [markers,   setMarkers]           = useState<MapMarker[]>([])
  const [selected,  setSelected]          = useState<string | null>(null)
  const [geocoding, setGeocoding]         = useState(false)

  const geocode = useCallback((address: string): Promise<{ lat: number; lng: number } | null> => {
    const cached = geocacheRef.current.get(address)
    if (cached !== undefined) return Promise.resolve(cached)
    return new Promise((resolve) => {
      new google.maps.Geocoder().geocode(
        { address: `${address}, Argentina`, componentRestrictions: { country: 'AR' } },
        (results, status) => {
          const pt = status === 'OK' && results?.[0]
            ? { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() }
            : null
          geocacheRef.current.set(address, pt)
          resolve(pt)
        },
      )
    })
  }, [])

  useEffect(() => {
    if (!isLoaded || orders.length === 0) { setMarkers([]); return }
    setGeocoding(true)
    Promise.all(
      orders.map(async (o, i) => {
        const pt = await geocode(o.clientAddress)
        if (!pt) return null
        return { id: o.id, ...pt, label: String(i + 1), color: o.driverId ? driverColor(o.driverId, choferes) : UNASSIGNED_COLOR, title: o.clientName, subtitle: summarizeProducts(o.products) }
      }),
    ).then((res) => { setMarkers(res.filter(Boolean) as MapMarker[]); setGeocoding(false) })
  }, [isLoaded, orders, choferes, geocode])

  useEffect(() => {
    if (!mapRef.current || markers.length === 0) return
    if (markers.length === 1) { mapRef.current.panTo({ lat: markers[0].lat, lng: markers[0].lng }); mapRef.current.setZoom(14); return }
    const bounds = new google.maps.LatLngBounds()
    markers.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }))
    mapRef.current.fitBounds(bounds, 60)
  }, [markers])

  const activeDrivers = choferes.filter((c) => orders.some((o) => o.driverId === c.email))

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden">
      {/* Header del mapa */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">Mapa del día</span>
          {geocoding
            ? <span className="text-xs text-gray-400 animate-pulse">geocodificando…</span>
            : markers.length > 0 && <span className="text-xs text-gray-400">{markers.length} paradas</span>
          }
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {activeDrivers.map((c) => (
            <span key={c.uid} className="flex items-center gap-1 text-xs text-gray-600">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: driverColor(c.email, choferes) }} />
              {c.nombreContacto || c.nombre}
            </span>
          ))}
          {orders.some((o) => !o.driverId) && (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              Sin asignar
            </span>
          )}
        </div>
      </div>

      {/* Mapa */}
      <div style={{ height: 340 }}>
        {!isLoaded
          ? <div className="w-full h-full bg-gray-100 animate-pulse" />
          : (
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '100%' }}
              center={{ lat: -34.6037, lng: -58.3816 }}
              zoom={12}
              options={{ disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative', styles: DARK_MAP_STYLES }}
              onLoad={(m) => { mapRef.current = m }}
            >
              {markers.map((m) => (
                <Marker
                  key={m.id}
                  position={{ lat: m.lat, lng: m.lng }}
                  icon={makePin(m.color, m.label)}
                  onClick={() => setSelected((s) => s === m.id ? null : m.id)}
                >
                  {selected === m.id && (
                    <InfoWindow onCloseClick={() => setSelected(null)}>
                      <div style={{ color: '#111', fontSize: 13, minWidth: 140, lineHeight: 1.5 }}>
                        <p style={{ fontWeight: 700, margin: '0 0 2px' }}>{m.title}</p>
                        <p style={{ margin: 0, color: '#555' }}>{m.subtitle}</p>
                      </div>
                    </InfoWindow>
                  )}
                </Marker>
              ))}
            </GoogleMap>
          )
        }
      </div>
    </div>
  )
}

// ── BandejaRow — pedido sin asignar ──────────────────────────────────────────

function BandejaRow({ order, choferes, days }: { order: Order; choferes: UserProfile[]; days: Date[] }) {
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState<string | null>(null)

  const dateStr = orderDateStr(order)
  const dayIdx  = days.findIndex((d) => dateToStr(d) === dateStr)
  const dayName = dayIdx === 0 ? 'Hoy'
    : dayIdx === 1 ? 'Mañana'
    : dayIdx >= 0 ? days[dayIdx].toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' })
    : dateStr

  const handleAssign = async (email: string) => {
    setLoading(email)
    await assignDriver(order.id, email)
    setLoading(null)
    setOpen(false)
  }

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-3 space-y-2.5">
      <div className="flex items-center gap-3">
        <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
          dayIdx === 0 ? 'bg-accent/10 text-accent' :
          dayIdx === 1 ? 'bg-blue-100 text-blue-700' :
          'bg-gray-100 text-gray-600'
        }`}>
          {dayName}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{order.clientName}</p>
          <p className="text-xs text-gray-500 truncate">{summarizeProducts(order.products)}</p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
            open ? 'bg-gray-100 text-gray-600' : 'bg-accent text-white hover:bg-accent/90'
          }`}
        >
          {open ? 'Cancelar' : 'Asignar →'}
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap gap-2 pt-1.5 border-t border-gray-100">
          {choferes.map((c) => {
            const color     = driverColor(c.email, choferes)
            const isLoading = loading === c.email
            return (
              <button
                key={c.uid}
                onClick={() => handleAssign(c.email)}
                disabled={loading !== null}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-all disabled:opacity-50 hover:scale-105 active:scale-95"
                style={{ borderColor: `${color}60`, backgroundColor: `${color}18`, color }}
              >
                {isLoading
                  ? <span className="w-2 h-2 rounded-full border border-current border-t-transparent animate-spin" />
                  : <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                }
                {c.nombreContacto || c.nombre}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── ChoferSection — pedidos por chofer en el día ──────────────────────────────

function ChoferSection({ chofer, camion, orders, catalogo, choferes }: {
  chofer:   UserProfile
  camion?:  Camion
  orders:   Order[]
  catalogo: CatalogProducto[]
  choferes: UserProfile[]
}) {
  if (orders.length === 0) return null

  const color        = driverColor(chofer.email, choferes)
  const totalPallets = orders.reduce((s, o) => s + calcPallets(o.products, catalogo), 0)
  const totalUni     = orders.reduce((s, o) => o.products.reduce((a, p) => a + p.quantity, s), 0)
  const overCapacity = camion?.capacidadPallets ? totalPallets > camion.capacidadPallets : false

  return (
    <div className={`bg-white border rounded-xl p-4 space-y-3 ${overCapacity ? 'border-red-300' : 'border-[#D3D1C7]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <div className="min-w-0">
            <p className="font-semibold text-sm text-gray-900">{chofer.nombreContacto || chofer.nombre}</p>
            {camion
              ? <p className="text-xs text-gray-500">🚛 {camion.patente} · {camion.modelo}</p>
              : <p className="text-xs text-amber-600">Sin camión asignado</p>
            }
          </div>
          {overCapacity && (
            <span className="text-xs bg-red-100 text-red-600 border border-red-200 px-2 py-0.5 rounded-full font-medium">
              ⚠ Sobrecarga
            </span>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className={`font-bold text-xl leading-none ${overCapacity ? 'text-red-600' : 'text-accent'}`}>{totalUni}</p>
          <p className="text-xs text-gray-500">unidades</p>
        </div>
      </div>

      {/* Pedidos */}
      <div className="divide-y divide-gray-100">
        {orders.map((o, i) => (
          <div key={o.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
              style={{ backgroundColor: color }}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">{o.clientName}</p>
              <p className="text-xs text-gray-500 truncate">{summarizeProducts(o.products)}</p>
            </div>
            <select
              value=""
              onChange={async (e) => { if (e.target.value) await assignDriver(o.id, e.target.value) }}
              className="text-xs text-gray-400 border border-[#D3D1C7] rounded-lg px-1.5 py-1 bg-white hover:text-gray-900 focus:outline-none shrink-0"
              title="Reasignar chofer"
            >
              <option value="">↺</option>
              {choferes.filter((c) => c.email !== chofer.email).map((c) => (
                <option key={c.uid} value={c.email}>{c.nombreContacto || c.nombre}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Capacidad */}
      {totalPallets > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <CapacityBar used={totalPallets} total={camion?.capacidadPallets} />
        </div>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function LogisticaDashboard() {
  const days = useMemo(() => next7Days(), [])

  const [selectedIdx,  setSelectedIdx]  = useState(1)   // default: mañana
  const [importModal,  setImportModal]  = useState(false)
  const [pedidoManual, setPedidoManual] = useState(false)

  const { orders,   loading: loadO } = useAllOrders()
  const { choferes, loading: loadC } = useChoferes()
  const { camiones }                  = useFlota()
  const { catalogo }                  = useCatalogo()

  const loading    = loadO || loadC
  const selectedStr = dateToStr(days[selectedIdx])

  // Pedidos sin chofer en los próximos 7 días
  const sinAsignarTodos = useMemo(() => {
    const strs = new Set(days.map(dateToStr))
    return orders
      .filter((o) => !o.driverId && !['entregado', 'cancelado'].includes(o.status) && strs.has(orderDateStr(o)))
      .sort((a, b) => orderDateStr(a).localeCompare(orderDateStr(b)))
  }, [orders, days])

  // Pedidos del día seleccionado
  const ordersDay = useMemo(
    () => orders.filter((o) => orderDateStr(o) === selectedStr && !['entregado', 'cancelado'].includes(o.status)),
    [orders, selectedStr],
  )

  // Estado visual de cada día para la barra
  const dayStatus = useMemo(() => days.map((d) => {
    const str      = dateToStr(d)
    const dayOrds  = orders.filter((o) => orderDateStr(o) === str && !['entregado', 'cancelado'].includes(o.status))
    const unassigned = dayOrds.filter((o) => !o.driverId).length
    const overload   = choferes.some((c) => {
      const cam = camiones.find((x) => x.id === c.camionId)
      if (!cam?.capacidadPallets) return false
      const pallets = dayOrds.filter((o) => o.driverId === c.email).reduce((s, o) => s + calcPallets(o.products, catalogo), 0)
      return pallets > cam.capacidadPallets
    })
    return { count: dayOrds.length, unassigned, overload }
  }), [orders, days, choferes, camiones, catalogo])

  // Si mañana no tiene pedidos, abrir hoy
  useEffect(() => {
    if (!loading && dayStatus[1].count === 0 && dayStatus[0].count > 0) setSelectedIdx(0)
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-3xl mx-auto p-4 space-y-5 pb-10">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Logística</h1>
            <p className="text-sm text-gray-500">
              {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setImportModal(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-2 bg-white border border-[#D3D1C7] rounded-xl hover:border-accent transition-colors text-gray-700"
            >
              <FileText size={14} />
              Cargar PDF
            </button>
            <button
              onClick={() => setPedidoManual(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-2 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors font-medium"
            >
              <Plus size={14} />
              Pedido manual
            </button>
          </div>
        </div>

        {loading ? <LoadingSpinner /> : (
          <>
            {/* ── Bandeja de entrada ─────────────────────────────────────── */}
            {sinAsignarTodos.length > 0 ? (
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-amber-500" />
                  <h2 className="text-sm font-semibold text-gray-900">
                    Sin planificar — {sinAsignarTodos.length} pedido{sinAsignarTodos.length !== 1 ? 's' : ''}
                  </h2>
                </div>
                <div className="space-y-2">
                  {sinAsignarTodos.map((o) => (
                    <BandejaRow key={o.id} order={o} choferes={choferes} days={days} />
                  ))}
                </div>
              </section>
            ) : (
              <div className="flex items-center gap-2.5 bg-white border border-green-200 rounded-xl px-4 py-3">
                <CheckCircle size={16} className="text-green-500 shrink-0" />
                <p className="text-sm font-medium text-green-700">Todo planificado para la semana</p>
              </div>
            )}

            {/* ── Barra de días ──────────────────────────────────────────── */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {days.map((d, i) => {
                const { count, unassigned, overload } = dayStatus[i]
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedIdx(i)}
                    className={`relative flex-shrink-0 flex flex-col items-center px-3 py-2.5 rounded-xl border transition-colors min-w-[68px] ${
                      i === selectedIdx
                        ? 'bg-accent text-white border-accent shadow-sm'
                        : 'bg-white border-[#D3D1C7] text-gray-700 hover:border-accent/50'
                    }`}
                  >
                    {count > 0 && (
                      <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full border-2 ${
                        i === selectedIdx ? 'border-accent' : 'border-[#F1EFE8]'
                      } ${overload ? 'bg-red-500' : unassigned > 0 ? 'bg-amber-400' : 'bg-green-500'}`} />
                    )}
                    <span className="text-xs font-semibold">{dayLabel(d, i)}</span>
                    <span className={`text-xs mt-0.5 ${i === selectedIdx ? 'text-white/70' : 'text-gray-400'}`}>
                      {d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                    </span>
                    {count > 0 && (
                      <span className={`mt-1 text-xs font-bold ${i === selectedIdx ? 'text-white' : 'text-accent'}`}>
                        {count} ped.
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* ── Vista del día ──────────────────────────────────────────── */}
            {ordersDay.length === 0 ? (
              <div className="bg-white border border-[#D3D1C7] rounded-xl p-10 text-center">
                <p className="text-4xl mb-3">📭</p>
                <p className="text-gray-500 text-sm">No hay pedidos para este día</p>
                <button
                  onClick={() => setPedidoManual(true)}
                  className="mt-3 text-xs text-accent hover:underline"
                >
                  + Agregar pedido manual
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Mapa siempre visible */}
                <DayMap orders={ordersDay} choferes={choferes} />

                {/* Sin asignar para este día */}
                {ordersDay.some((o) => !o.driverId) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                    <p className="text-sm font-semibold text-amber-700 flex items-center gap-2">
                      <AlertTriangle size={14} />
                      {ordersDay.filter((o) => !o.driverId).length} sin asignar para este día
                    </p>
                    <div className="space-y-2">
                      {ordersDay.filter((o) => !o.driverId).map((o) => (
                        <BandejaRow key={o.id} order={o} choferes={choferes} days={days} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Sección por chofer */}
                {choferes.map((chofer) => (
                  <ChoferSection
                    key={chofer.uid}
                    chofer={chofer}
                    camion={camiones.find((c) => c.id === chofer.camionId)}
                    orders={ordersDay.filter((o) => o.driverId === chofer.email)}
                    catalogo={catalogo}
                    choferes={choferes}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <ImportarPedidoModal open={importModal} onClose={() => setImportModal(false)} />
      <PedidoManualModal   open={pedidoManual} onClose={() => setPedidoManual(false)} defaultDate={selectedStr} />
    </div>
  )
}
