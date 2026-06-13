import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { GoogleMap, Marker, InfoWindow } from '@react-google-maps/api'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { useAllOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { useFlota } from '../../hooks/useFlota'
import { useCatalogo } from '../../hooks/useCatalogo'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { useProgramasVisita, useVisitasPuntuales, programasParaFecha, visitasParaFecha } from '../../hooks/useVisitas'
import { assignDriver } from '../../services/orderService'
import { saveCatalogo } from '../../services/catalogoService'
import { getAsignacionesDia, setAsignacionChofer, AsignacionesDia } from '../../services/asignacionesDiaService'
import { addVisitaPuntual, deleteVisitaPuntual } from '../../services/visitasService'
import PedidoManualModal from '../../components/admin/PedidoManualModal'
import { getPushSubscriptionByEmail, getAllUsers } from '../../services/userService'
import { sendPush } from '../../services/notificationService'
import { Order, UserProfile, Camion, CatalogProducto, getPrimaryAddress } from '../../types'
import { calcPallets, summarizeProducts, formatShortDate } from '../../utils/helpers'
import { Timestamp } from 'firebase/firestore'

// ── Constantes ────────────────────────────────────────────────────────────────

const DRIVER_COLORS = ['#00C2FF', '#FF6B6B', '#4ECDC4', '#A8E6CF', '#FFE66D', '#C084FC', '#F97316', '#34D399']
const VISIT_COLOR        = '#A78BFA'
const UNASSIGNED_COLOR   = '#F59E0B'
const INACTIVE_CLIENT_COLOR = '#6B7280'

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry',           stylers: [{ color: '#0A1628' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A1628' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#74a0c8' }] },
  { featureType: 'road',         elementType: 'geometry', stylers: [{ color: '#1E3A5F' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#163868' }] },
  { featureType: 'water',        elementType: 'geometry', stylers: [{ color: '#05101e' }] },
  { featureType: 'poi',          stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',      stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', elementType: 'labels', stylers: [{ visibility: 'off' }] },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPallets(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 1 })
}

function dateToStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function orderDateStr(o: Order): string {
  if (!o.date?.toDate) return ''
  return dateToStr(o.date.toDate())
}

function next7Days(): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() + i)
    return d
  })
}

function dayShort(d: Date, idx: number): string {
  if (idx === 0) return 'Hoy'
  if (idx === 1) return 'Mañana'
  return d.toLocaleDateString('es-AR', { weekday: 'short' })
}

function dayFull(d: Date): string {
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
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

function clientLabel(u: UserProfile): string {
  return u.razonSocial || u.nombreContacto || u.nombre || u.email
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function thisWeekRange(): [Date, Date] {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return [monday, sunday]
}

// ── CapacityBar ───────────────────────────────────────────────────────────────

function CapacityBar({ used, total, compact }: { used: number; total?: number; compact?: boolean }) {
  const rounded = Math.ceil(used * 10) / 10
  if (!total) return used > 0 && !compact ? <p className="text-xs text-gray-500">{rounded} pallets</p> : null
  const pct   = Math.min((used / total) * 100, 100)
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-orange-400' : 'bg-success'
  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-xs font-medium ${pct >= 90 ? 'text-red-400' : pct >= 70 ? 'text-orange-400' : 'text-success'}`}>
          {Math.round(pct)}%
        </span>
      </div>
    )
  }
  const remaining = total - used
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">{fmtPallets(used)} / {total} pallets cargados</span>
        <span className={pct >= 90 ? 'text-red-400 font-semibold' : pct >= 70 ? 'text-orange-400' : 'text-success'}>
          {Math.round(pct)}%
        </span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {remaining > 0 ? (
        <p className="text-xs text-gray-500">
          Quedan <span className="text-gray-900 font-medium">{fmtPallets(remaining)}</span> pallets libres
        </p>
      ) : (
        <p className="text-xs text-red-400 font-medium">Camión al límite de capacidad</p>
      )}
    </div>
  )
}

// ── WeekCard ──────────────────────────────────────────────────────────────────

function WeekCard({
  day, idx, orders, choferes, camiones, catalogo,
  programas, visitas, onSelect,
}: {
  day:       Date
  idx:       number
  orders:    Order[]
  choferes:  UserProfile[]
  camiones:  Camion[]
  catalogo:  CatalogProducto[]
  programas: ReturnType<typeof programasParaFecha>
  visitas:   ReturnType<typeof visitasParaFecha>
  onSelect:  (idx: number) => void
}) {
  const str       = dateToStr(day)
  const dayOrders = orders.filter((o) => orderDateStr(o) === str && !['entregado', 'cancelado'].includes(o.status))
  const dayProgramas = programasParaFecha(programas as any, day)
  const dayVisitas   = visitasParaFecha(visitas as any, day)
  const sinAsignar   = dayOrders.filter((o) => !o.driverId).length
  const totalUnidades = dayOrders.reduce((sum, o) => o.products.reduce((s, p) => s + p.quantity, sum), 0)
  const totalPallets  = dayOrders.reduce((sum, o) => sum + calcPallets(o.products, catalogo), 0)

  // Capacidad total de camiones asignados ese día
  const camionesCapacity = choferes.reduce((sum, c) => {
    const tieneOrden = dayOrders.some((o) => o.driverId === c.email)
    if (!tieneOrden) return sum
    const cam = camiones.find((cam) => cam.id === c.camionId)
    return sum + (cam?.capacidadPallets ?? 0)
  }, 0)

  // Drivers con pedidos ese día
  const activeDriverEmails = [...new Set(dayOrders.filter((o) => o.driverId).map((o) => o.driverId!))]

  const isEmpty = dayOrders.length === 0 && dayProgramas.length === 0 && dayVisitas.length === 0

  return (
    <button
      onClick={() => onSelect(idx)}
      className={`w-full text-left bg-white border rounded-xl p-4 space-y-3 transition-colors hover:border-accent/50 ${
        idx === 0 ? 'border-accent/40' : 'border-[#D3D1C7]'
      }`}
    >
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <p className={`font-bold text-sm ${idx === 0 ? 'text-accent' : 'text-gray-900'}`}>
            {dayShort(day, idx)}
          </p>
          <p className="text-xs text-gray-500">
            {day.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
          </p>
        </div>
        {!isEmpty && (
          <div className="text-right">
            <p className="text-accent font-bold text-lg leading-none">{dayOrders.length}</p>
            <p className="text-xs text-gray-500">pedidos</p>
          </div>
        )}
      </div>

      {isEmpty ? (
        <p className="text-xs text-gray-400">Sin actividad</p>
      ) : (
        <>
          {/* Totales */}
          {totalUnidades > 0 && (
            <p className="text-xs text-gray-500">
              {totalUnidades.toLocaleString('es-AR')} u
              {totalPallets > 0 && ` · ${fmtPallets(totalPallets)} pallets`}
              {(dayProgramas.length + dayVisitas.length) > 0 && (
                <span className="ml-1 text-violet-400">
                  · {dayProgramas.length + dayVisitas.length} visita{dayProgramas.length + dayVisitas.length !== 1 ? 's' : ''}
                </span>
              )}
            </p>
          )}

          {/* Barra capacidad */}
          {totalPallets > 0 && camionesCapacity > 0 && (
            <CapacityBar used={totalPallets} total={camionesCapacity} compact />
          )}

          {/* Drivers */}
          {activeDriverEmails.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeDriverEmails.map((email) => {
                const chofer = choferes.find((c) => c.email === email)
                const count  = dayOrders.filter((o) => o.driverId === email).length
                const color  = driverColor(email, choferes)
                return (
                  <span
                    key={email}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
                    style={{ borderColor: `${color}40`, backgroundColor: `${color}15`, color }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: color }} />
                    {chofer?.nombreContacto || chofer?.nombre || email.split('@')[0]} · {count}
                  </span>
                )
              })}
            </div>
          )}

          {/* Alertas */}
          {sinAsignar > 0 && (
            <p className="text-xs text-yellow-400 font-medium">⚠ {sinAsignar} sin asignar</p>
          )}
        </>
      )}

      <p className="text-xs text-accent/60 text-right">Ver detalle →</p>
    </button>
  )
}

// ── DayMap ────────────────────────────────────────────────────────────────────

interface MapMarker {
  id:       string
  lat:      number
  lng:      number
  label:    string
  color:    string
  title:    string
  subtitle: string
  type:     'order' | 'visit' | 'inactive'
}

function DayMap({
  orders,
  visitas,
  programas,
  choferes,
  allClients,
  onAddVisita,
  onDeleteVisita,
}: {
  orders:       Order[]
  visitas:      ReturnType<typeof visitasParaFecha>
  programas:    ReturnType<typeof programasParaFecha>
  choferes:     UserProfile[]
  allClients:   UserProfile[]
  onAddVisita?:    (client: UserProfile, driverId: string) => Promise<void>
  onDeleteVisita?: (visitaId: string) => Promise<void>
}) {
  const { isLoaded }                      = useGoogleMapsLoader()
  const mapRef                             = useRef<google.maps.Map | null>(null)
  const geocacheRef                        = useRef<Map<string, { lat: number; lng: number } | null>>(new Map())
  const [markers, setMarkers]             = useState<MapMarker[]>([])
  const [selected, setSelected]           = useState<string | null>(null)
  const [geocoding, setGeocoding]         = useState(false)
  const [open, setOpen]                   = useState(true)
  const [showInactivos, setShowInactivos]   = useState(false)
  const [addingVisita,  setAddingVisita]    = useState<string | null>(null)
  const [visitaChofer,  setVisitaChofer]    = useState<string>('')
  const [deletingVisita, setDeletingVisita] = useState<string | null>(null)

  // Clientes sin pedido hoy que tienen coordenadas guardadas
  const inactiveMarkers = useMemo<MapMarker[]>(() => {
    if (!showInactivos) return []
    const occupiedIds = new Set([
      ...orders.map((o) => o.clientId),
      ...visitas.map((v) => v.clientId),
      ...programas.map((p) => p.clientId),
    ].filter(Boolean))
    return allClients
      .filter((c) => c.rol === 'cliente' && c.estado === 'activo' && !occupiedIds.has(c.uid))
      .flatMap((c) => {
        const addr = getPrimaryAddress(c)
        if (!addr?.lat || !addr?.lng) return []
        return [{
          id:       `inactive-${c.uid}`,
          lat:      addr.lat,
          lng:      addr.lng,
          label:    '●',
          color:    INACTIVE_CLIENT_COLOR,
          title:    c.nombre || c.nombreContacto || c.email,
          subtitle: 'Sin pedido hoy',
          type:     'inactive' as const,
        }]
      })
  }, [showInactivos, allClients, orders, visitas, programas])

  const geocodeAddress = useCallback(
    (address: string): Promise<{ lat: number; lng: number } | null> => {
      const cached = geocacheRef.current.get(address)
      if (cached !== undefined) return Promise.resolve(cached)
      return new Promise((resolve) => {
        const geocoder = new google.maps.Geocoder()
        geocoder.geocode(
          { address: `${address}, Argentina`, componentRestrictions: { country: 'AR' } },
          (results, status) => {
            if (status === 'OK' && results?.[0]) {
              const loc = results[0].geometry.location
              const pt  = { lat: loc.lat(), lng: loc.lng() }
              geocacheRef.current.set(address, pt)
              resolve(pt)
            } else {
              geocacheRef.current.set(address, null)
              resolve(null)
            }
          },
        )
      })
    },
    [],
  )

  useEffect(() => {
    if (!isLoaded) return

    const items: Array<{ id: string; address: string; label: string; color: string; title: string; subtitle: string; type: 'order' | 'visit' }> = [
      ...orders.map((o, i) => ({
        id:       o.id,
        address:  o.clientAddress,
        label:    String(i + 1),
        color:    o.driverId ? driverColor(o.driverId, choferes) : UNASSIGNED_COLOR,
        title:    o.clientName,
        subtitle: summarizeProducts(o.products) + (o.horaEntrega ? ` · ${o.horaEntrega}hs` : ''),
        type:     'order' as const,
      })),
      ...visitas.map((v) => ({
        id:       `v-${v.id}`,
        address:  v.clientAddress,
        label:    '📅',
        color:    v.driverId ? driverColor(v.driverId, choferes) : VISIT_COLOR,
        title:    v.clientName,
        subtitle: 'Visita puntual' + (v.driverId ? ` · ${choferes.find(c => c.email === v.driverId)?.nombreContacto || choferes.find(c => c.email === v.driverId)?.nombre || ''}` : ''),
        type:     'visit' as const,
      })),
      ...programas.map((p) => ({
        id:       `p-${p.id}`,
        address:  p.clientAddress,
        label:    '🔄',
        color:    VISIT_COLOR,
        title:    p.clientName,
        subtitle: 'Visita recurrente',
        type:     'visit' as const,
      })),
    ].filter((x) => x.address)

    if (items.length === 0) { setMarkers([]); return }
    setGeocoding(true)

    Promise.all(
      items.map(async (item) => {
        const pt = await geocodeAddress(item.address)
        if (!pt) return null
        return { ...item, ...pt }
      }),
    ).then((results) => {
      setMarkers(results.filter(Boolean) as MapMarker[])
      setGeocoding(false)
    })
  }, [isLoaded, orders, visitas, programas, choferes, geocodeAddress])

  // Auto-fit cuando cambian los marcadores
  useEffect(() => {
    if (!mapRef.current || markers.length === 0) return
    if (markers.length === 1) {
      mapRef.current.panTo({ lat: markers[0].lat, lng: markers[0].lng })
      mapRef.current.setZoom(14)
      return
    }
    const bounds = new google.maps.LatLngBounds()
    markers.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }))
    mapRef.current.fitBounds(bounds, 60)
  }, [markers])

  const allItems = orders.length + visitas.length + programas.length
  if (allItems === 0) return null

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex justify-between items-center px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">🗺 Mapa del día</span>
          {geocoding && <span className="text-xs text-gray-500 animate-pulse">Geocodificando…</span>}
          {!geocoding && markers.length > 0 && (
            <span className="text-xs text-gray-500">{markers.length} ubicaciones</span>
          )}
        </div>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div>
          {/* Leyenda */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pb-3">
            {choferes
              .filter((c) => orders.some((o) => o.driverId === c.email))
              .map((c) => (
                <span key={c.uid} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: driverColor(c.email, choferes) }} />
                  {c.nombreContacto || c.nombre}
                </span>
              ))}
            {orders.some((o) => !o.driverId) && (
              <span className="flex items-center gap-1.5 text-xs text-yellow-400">
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 shrink-0" />
                Sin asignar
              </span>
            )}
            {/* Toggle clientes sin pedido */}
            <button
              onClick={() => setShowInactivos((v) => !v)}
              className={`flex items-center gap-1.5 text-xs transition-opacity ${showInactivos ? 'opacity-100' : 'opacity-50 hover:opacity-80'}`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: INACTIVE_CLIENT_COLOR }} />
              {showInactivos
                ? `Sin pedido hoy (${inactiveMarkers.length})`
                : 'Ver clientes sin pedido'}
            </button>
          </div>

          <div style={{ height: '360px' }}>
            {!isLoaded ? (
              <div className="w-full h-full bg-gray-100 animate-pulse" />
            ) : (
              <GoogleMap
                mapContainerStyle={{ width: '100%', height: '100%' }}
                center={{ lat: -34.6037, lng: -58.3816 }}
                zoom={12}
                options={{
                  disableDefaultUI: true,
                  zoomControl:      true,
                  gestureHandling:  'cooperative',
                  styles:           DARK_MAP_STYLES,
                }}
                onLoad={(m) => { mapRef.current = m }}
              >
                {/* Clientes sin pedido (grises, al fondo) */}
                {inactiveMarkers.map((m) => {
                  const clientUid = m.id.replace('inactive-', '')
                  const client    = allClients.find((c) => c.uid === clientUid)
                  const isAdding  = addingVisita === clientUid
                  return (
                    <Marker
                      key={m.id}
                      position={{ lat: m.lat, lng: m.lng }}
                      icon={makePin(m.color, m.label)}
                      onClick={() => setSelected((s) => (s === m.id ? null : m.id))}
                      zIndex={1}
                    >
                      {selected === m.id && (
                        <InfoWindow onCloseClick={() => { setSelected(null); setVisitaChofer('') }}>
                          <div style={{ color: '#111', minWidth: '200px', fontSize: '13px', lineHeight: '1.6' }}>
                            <p style={{ margin: '0 0 2px', fontWeight: 700 }}>{m.title}</p>
                            <p style={{ margin: '0 0 10px', color: '#888', fontSize: '12px' }}>Sin pedido hoy</p>
                            {client && onAddVisita && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {/* Selector de chofer */}
                                <select
                                  value={visitaChofer}
                                  onChange={(e) => setVisitaChofer(e.target.value)}
                                  style={{
                                    width:        '100%',
                                    padding:      '5px 8px',
                                    border:       '1px solid #ccc',
                                    borderRadius: '6px',
                                    fontSize:     '12px',
                                    background:   '#fff',
                                    color:        '#111',
                                    cursor:       'pointer',
                                  }}
                                >
                                  <option value="">— Sin chofer asignado —</option>
                                  {choferes.map((c) => (
                                    <option key={c.uid} value={c.email}>
                                      {c.nombreContacto || c.nombre || c.email}
                                    </option>
                                  ))}
                                </select>
                                {/* Botón agendar */}
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    setAddingVisita(clientUid)
                                    try {
                                      await onAddVisita(client, visitaChofer)
                                      setSelected(null)
                                      setVisitaChofer('')
                                    } finally {
                                      setAddingVisita(null)
                                    }
                                  }}
                                  disabled={isAdding}
                                  style={{
                                    display:      'block',
                                    width:        '100%',
                                    padding:      '6px 10px',
                                    background:   isAdding ? '#aaa' : '#2D6A4F',
                                    color:        '#fff',
                                    border:       'none',
                                    borderRadius: '6px',
                                    cursor:       isAdding ? 'default' : 'pointer',
                                    fontSize:     '12px',
                                    fontWeight:   600,
                                  }}
                                >
                                  {isAdding ? 'Agendando…' : '📅 Agendar visita'}
                                </button>
                              </div>
                            )}
                          </div>
                        </InfoWindow>
                      )}
                    </Marker>
                  )
                })}
                {/* Pedidos y visitas del día (encima) */}
                {markers.map((m) => {
                  const isVisitaPuntual = m.id.startsWith('v-')
                  const visitaId        = isVisitaPuntual ? m.id.slice(2) : null
                  const isDeleting      = deletingVisita === visitaId
                  return (
                    <Marker
                      key={m.id}
                      position={{ lat: m.lat, lng: m.lng }}
                      icon={makePin(m.color, m.label)}
                      onClick={() => setSelected((s) => (s === m.id ? null : m.id))}
                      zIndex={10}
                    >
                      {selected === m.id && (
                        <InfoWindow onCloseClick={() => setSelected(null)}>
                          <div style={{ color: '#111', minWidth: '160px', fontSize: '13px', lineHeight: '1.5' }}>
                            <p style={{ margin: '0 0 3px', fontWeight: 700 }}>{m.title}</p>
                            <p style={{ margin: isVisitaPuntual ? '0 0 8px' : 0, color: '#555' }}>{m.subtitle}</p>
                            {isVisitaPuntual && onDeleteVisita && visitaId && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  setDeletingVisita(visitaId)
                                  try {
                                    await onDeleteVisita(visitaId)
                                    setSelected(null)
                                  } finally {
                                    setDeletingVisita(null)
                                  }
                                }}
                                disabled={isDeleting}
                                style={{
                                  display:      'block',
                                  width:        '100%',
                                  padding:      '5px 10px',
                                  background:   isDeleting ? '#aaa' : '#ef4444',
                                  color:        '#fff',
                                  border:       'none',
                                  borderRadius: '6px',
                                  cursor:       isDeleting ? 'default' : 'pointer',
                                  fontSize:     '12px',
                                  fontWeight:   600,
                                }}
                              >
                                {isDeleting ? 'Eliminando…' : '🗑 Eliminar visita'}
                              </button>
                            )}
                          </div>
                        </InfoWindow>
                      )}
                    </Marker>
                  )
                })}
              </GoogleMap>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── ChoferCard ────────────────────────────────────────────────────────────────

function ChoferCard({
  chofer, camion, orders, visitas, programas, catalogo, choferes,
  camiones, ayudantes, asignacion, onAsignacionChange,
}: {
  chofer:    UserProfile | null
  camion?:   Camion
  orders:    Order[]
  visitas:   ReturnType<typeof visitasParaFecha>
  programas: ReturnType<typeof programasParaFecha>
  catalogo:  CatalogProducto[]
  choferes:  UserProfile[]
  camiones:  Camion[]
  ayudantes: UserProfile[]
  asignacion: { camionId: string | null; ayudanteEmail: string | null }
  onAsignacionChange: (camionId: string | null, ayudanteEmail: string | null) => void
}) {
  const [notifying, setNotifying] = useState(false)
  const [notified,  setNotified]  = useState(false)

  const camionEfectivo = camiones.find((c) => c.id === (asignacion.camionId ?? chofer?.camionId)) ?? camion
  const ayudante       = ayudantes.find((a) => a.email === asignacion.ayudanteEmail)

  const nombre       = chofer ? (chofer.nombreContacto || chofer.nombre || chofer.email) : 'Sin asignar'
  const totalPallets = orders.reduce((sum, o) => sum + calcPallets(o.products, catalogo), 0)
  const totalUni     = orders.reduce((sum, o) => o.products.reduce((s, p) => s + p.quantity, sum), 0)
  const overCapacity = camionEfectivo?.capacidadPallets ? totalPallets > camionEfectivo.capacidadPallets : false
  const totalParadas = orders.length + visitas.length + programas.length

  const handleNotify = async () => {
    if (!chofer) return
    setNotifying(true)
    try {
      const sub = await getPushSubscriptionByEmail(chofer.email)
      if (sub) {
        await sendPush({
          subscription: sub,
          title: '🧊 Ruta lista para hoy',
          body:  `${totalParadas} parada${totalParadas !== 1 ? 's' : ''} · ${totalUni.toLocaleString('es-AR')} unidades`,
        })
        setNotified(true)
        setTimeout(() => setNotified(false), 3000)
      }
    } finally {
      setNotifying(false)
    }
  }

  if (orders.length === 0 && visitas.length === 0 && programas.length === 0 && chofer) return null

  return (
    <div className={`bg-white border rounded-xl p-4 space-y-3 ${overCapacity ? 'border-red-400' : !chofer ? 'border-amber-300' : 'border-[#D3D1C7]'}`}>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm text-gray-900">{nombre}</p>
            {overCapacity && (
              <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-medium">
                ⚠ Sobrecarga
              </span>
            )}
          </div>
          {chofer && (
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {/* Selector camión */}
              <select
                value={asignacion.camionId ?? chofer.camionId ?? ''}
                onChange={(e) => onAsignacionChange(e.target.value || null, asignacion.ayudanteEmail)}
                className="text-xs bg-gray-50 border border-[#D3D1C7] rounded-lg px-2 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">🚛 Sin camión</option>
                {camiones.map((c) => (
                  <option key={c.id} value={c.id}>
                    🚛 {c.patente}{c.modelo ? ` · ${c.modelo}` : ''}
                  </option>
                ))}
              </select>
              {/* Selector ayudante */}
              <select
                value={asignacion.ayudanteEmail ?? ''}
                onChange={(e) => onAsignacionChange(asignacion.camionId, e.target.value || null)}
                className="text-xs bg-gray-50 border border-[#D3D1C7] rounded-lg px-2 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">👤 Sin ayudante</option>
                {ayudantes.map((a) => (
                  <option key={a.uid} value={a.email}>
                    👤 {a.nombreContacto || a.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Botón notificar chofer */}
          {chofer && totalParadas > 0 && (
            <button
              onClick={handleNotify}
              disabled={notifying || notified}
              title="Notificar al chofer que la ruta está lista"
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors font-medium ${
                notified
                  ? 'bg-success/20 text-success'
                  : 'bg-accent/10 hover:bg-accent/25 text-accent'
              }`}
            >
              {notified ? '✓ Enviado' : notifying ? '…' : '🔔 Notificar'}
            </button>
          )}
          {totalUni > 0 && (
            <div className="text-right">
              <p className={`font-bold ${overCapacity ? 'text-red-600' : 'text-accent'}`}>{totalUni}</p>
              <p className="text-xs text-gray-500">unidades</p>
            </div>
          )}
        </div>
      </div>

      {orders.map((o) => (
        <div key={o.id} className="flex items-start gap-2">
          <span className="shrink-0 mt-0.5">📦</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate text-gray-900">
              {o.clientName}
              {o.origenPdf && <span className="ml-1.5 text-xs text-accent/70">OC</span>}
            </p>
            <p className="text-xs text-gray-500 truncate">{summarizeProducts(o.products)}</p>
            {o.horaEntrega && <p className="text-xs text-gray-500">{o.horaEntrega} hs</p>}
          </div>
          <select
            value=""
            onChange={async (e) => {
              const email = e.target.value
              if (!email) return
              await assignDriver(o.id, email)
              getPushSubscriptionByEmail(email).then((sub) => {
                if (sub) sendPush({
                  subscription: sub,
                  title: 'Pedido reasignado',
                  body:  `${o.clientName} — ${formatShortDate(o.date)}`,
                })
              }).catch(console.error)
            }}
            className="bg-white border border-[#D3D1C7] rounded-lg px-1.5 py-1 text-xs text-gray-500 hover:text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent shrink-0 mt-0.5"
            title="Cambiar chofer"
          >
            <option value="">↺</option>
            {choferes
              .filter((c) => c.email !== chofer?.email)
              .map((c) => (
                <option key={c.uid} value={c.email}>{c.nombreContacto || c.nombre}</option>
              ))}
          </select>
        </div>
      ))}

      {visitas.map((v) => (
        <div key={v.id} className="flex items-center gap-2">
          <span className="shrink-0">📅</span>
          <p className="text-sm truncate text-gray-500">Visita: <span className="text-gray-900">{v.clientName}</span></p>
        </div>
      ))}

      {programas.map((p) => (
        <div key={p.id} className="flex items-center gap-2">
          <span className="shrink-0">🔄</span>
          <p className="text-sm truncate text-gray-500">Recurrente: <span className="text-gray-900">{p.clientName}</span></p>
        </div>
      ))}

      {totalPallets > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <CapacityBar used={totalPallets} total={camionEfectivo?.capacidadPallets} />
        </div>
      )}
    </div>
  )
}

// ── SinAsignarCard ────────────────────────────────────────────────────────────

function SinAsignarCard({ orders, choferes }: { orders: Order[]; choferes: UserProfile[] }) {
  if (orders.length === 0) return null
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
      <p className="font-semibold text-sm text-amber-700">Sin asignar ({orders.length})</p>
      <div className="space-y-2">
        {orders.map((o) => (
          <div key={o.id} className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate text-gray-900">{o.clientName}</p>
              <p className="text-xs text-gray-500 truncate">{summarizeProducts(o.products)}</p>
            </div>
            <select
              defaultValue=""
              onChange={async (e) => {
                const email = e.target.value
                if (!email) return
                await assignDriver(o.id, email)
                getPushSubscriptionByEmail(email).then((sub) => {
                  if (sub) sendPush({
                    subscription: sub,
                    title: 'Nuevo pedido asignado',
                    body:  `${o.clientName} — ${formatShortDate(o.date)}`,
                  })
                }).catch(console.error)
              }}
              className="bg-white border border-[#D3D1C7] rounded-lg px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent shrink-0"
            >
              <option value="">Asignar →</option>
              {choferes.map((c) => (
                <option key={c.uid} value={c.email}>{c.nombreContacto || c.nombre}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── PalletConfigModal ─────────────────────────────────────────────────────────

function PalletConfigModal({
  open,
  onClose,
  catalogo,
}: {
  open:     boolean
  onClose:  () => void
  catalogo: CatalogProducto[]
}) {
  const queryClient             = useQueryClient()
  const [values, setValues]     = useState<Record<string, string>>({})
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    if (open) {
      const init: Record<string, string> = {}
      for (const p of catalogo) {
        init[p.id] = p.unidadesPorPallet ? String(p.unidadesPorPallet) : ''
      }
      setValues(init)
    }
  }, [open, catalogo])

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated: CatalogProducto[] = catalogo.map((p) => {
        const num = parseInt(values[p.id] ?? '', 10)
        const base: CatalogProducto = { id: p.id, nombre: p.nombre, unidad: p.unidad }
        if (num > 0) base.unidadesPorPallet = num
        return base
      })
      await saveCatalogo(updated)
      queryClient.invalidateQueries({ queryKey: ['catalogo'] })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Unidades por pallet">
      <div className="space-y-1 mb-4">
        <p className="text-xs text-muted">
          Configurá cuántas unidades entran en un pallet para cada producto.
          Esto permite calcular cuántos pallets se necesitan por día.
        </p>
      </div>
      <div className="space-y-3">
        {catalogo.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{p.nombre}</p>
              <p className="text-xs text-muted">por {p.unidad}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="number"
                min="1"
                value={values[p.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                placeholder="—"
                className="w-20 text-right bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="text-xs text-muted w-12">u/pallet</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button onClick={handleSave} loading={saving} className="flex-1">Guardar</Button>
      </div>
    </Modal>
  )
}

// ── PalletSummary ─────────────────────────────────────────────────────────────

function PalletSummary({
  orders,
  catalogo,
  camiones,
  choferes,
  onConfigure,
}: {
  orders:      Order[]
  catalogo:    CatalogProducto[]
  camiones:    Camion[]
  choferes:    UserProfile[]
  onConfigure: () => void
}) {
  const [open, setOpen] = useState(true)

  const byProduct = useMemo(() => {
    const map: Record<string, { nombre: string; unidad: string; totalUnidades: number; unidadesPorPallet?: number }> = {}
    for (const o of orders) {
      for (const p of o.products) {
        const id  = p.productoId ?? p.name
        if (!map[id]) {
          const cat = catalogo.find((c) => c.id === p.productoId || c.nombre === p.name)
          map[id]   = { nombre: p.name, unidad: cat?.unidad ?? '', totalUnidades: 0, unidadesPorPallet: cat?.unidadesPorPallet }
        }
        map[id].totalUnidades += p.quantity
      }
    }
    return Object.values(map).sort((a, b) => b.totalUnidades - a.totalUnidades)
  }, [orders, catalogo])

  // Desglose por chofer/camión
  const byChofer = useMemo(() => {
    const map: Record<string, {
      email: string
      nombre: string
      camion?: Camion
      productos: Record<string, { nombre: string; unidad: string; totalUnidades: number; unidadesPorPallet?: number }>
      totalPallets: number
    }> = {}

    for (const o of orders) {
      const key = o.driverId ?? '__sin_asignar__'
      if (!map[key]) {
        const chofer = choferes.find((c) => c.email === o.driverId)
        const camion = camiones.find((c) => c.id === chofer?.camionId)
        const nombre = chofer
          ? (chofer.nombreContacto || chofer.nombre || chofer.email)
          : 'Sin asignar'
        map[key] = { email: key, nombre, camion, productos: {}, totalPallets: 0 }
      }
      for (const p of o.products) {
        const id = p.productoId ?? p.name
        if (!map[key].productos[id]) {
          const cat = catalogo.find((c) => c.id === p.productoId || c.nombre === p.name)
          map[key].productos[id] = { nombre: p.name, unidad: cat?.unidad ?? '', totalUnidades: 0, unidadesPorPallet: cat?.unidadesPorPallet }
        }
        map[key].productos[id].totalUnidades += p.quantity
      }
      map[key].totalPallets += calcPallets(o.products, catalogo)
    }

    return Object.values(map).sort((a, b) => {
      if (a.email === '__sin_asignar__') return 1
      if (b.email === '__sin_asignar__') return -1
      return a.nombre.localeCompare(b.nombre)
    })
  }, [orders, catalogo, choferes, camiones])

  const totalPallets = useMemo(
    () => orders.reduce((sum, o) => sum + calcPallets(o.products, catalogo), 0),
    [orders, catalogo],
  )

  const capacidadTotal = useMemo(() => {
    const activeDrivers = [...new Set(orders.filter((o) => o.driverId).map((o) => o.driverId!))]
    return activeDrivers.reduce((sum, email) => {
      const chofer = choferes.find((c) => c.email === email)
      const camion = camiones.find((c) => c.id === chofer?.camionId)
      return sum + (camion?.capacidadPallets ?? 0)
    }, 0)
  }, [orders, choferes, camiones])

  const hasConfig = byProduct.some((p) => p.unidadesPorPallet)
  if (orders.length === 0) return null

  const overCapacity = capacidadTotal > 0 && totalPallets > capacidadTotal

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex justify-between items-center px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">📦 Pallets del día</span>
          {hasConfig && totalPallets > 0 && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              overCapacity ? 'bg-red-500/20 text-red-400' : 'bg-success/10 text-success'
            }`}>
              {fmtPallets(totalPallets)} pallets{overCapacity ? ' ⚠ sobrecarga' : ''}
            </span>
          )}
        </div>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* Per-product rows */}
          <div className="space-y-2.5">
            {byProduct.map((p) => {
              const pallets = p.unidadesPorPallet ? p.totalUnidades / p.unidadesPorPallet : null
              return (
                <div key={p.nombre} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate text-gray-900">{p.nombre}</p>
                    <p className="text-xs text-gray-500">
                      {p.totalUnidades.toLocaleString('es-AR')} {p.unidad}s
                      {p.unidadesPorPallet ? ` · ${p.unidadesPorPallet} u/pallet` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {pallets !== null ? (
                      <>
                        <p className="text-accent font-bold text-lg leading-none">{fmtPallets(pallets)}</p>
                        <p className="text-xs text-gray-500">pallets</p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-400 italic">sin config</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desglose por chofer/camión */}
          {byChofer.length > 1 && (
            <div className="pt-3 border-t border-gray-100 space-y-3">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Por camión</p>
              {byChofer.map((c) => {
                const productos = Object.values(c.productos)
                const hasPallets = c.totalPallets > 0
                return (
                  <div key={c.email} className="bg-gray-50 rounded-lg p-3 space-y-2">
                    {/* Cabecera chofer */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate text-gray-900">{c.nombre}</p>
                        {c.camion ? (
                          <p className="text-xs text-gray-500">🚛 {c.camion.patente} · {c.camion.modelo}</p>
                        ) : (
                          <p className="text-xs text-amber-600">Sin camión asignado</p>
                        )}
                      </div>
                      {hasPallets && (
                        <div className="text-right shrink-0">
                          <p className="text-accent font-bold text-lg leading-none">{fmtPallets(c.totalPallets)}</p>
                          <p className="text-xs text-gray-500">pallets</p>
                        </div>
                      )}
                    </div>
                    {/* Productos */}
                    <div className="space-y-1">
                      {productos.map((p) => (
                        <div key={p.nombre} className="flex justify-between text-xs">
                          <span className="text-gray-500 truncate">{p.nombre}</span>
                          <span className="text-gray-900 font-medium shrink-0 ml-2">
                            {p.totalUnidades.toLocaleString('es-AR')} {p.unidad}s
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Barra capacidad individual */}
                    {hasPallets && c.camion?.capacidadPallets && (
                      <CapacityBar used={c.totalPallets} total={c.camion.capacidadPallets} />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Total vs capacity */}
          {hasConfig && totalPallets > 0 && (
            <div className="pt-3 border-t border-gray-100 space-y-2">
              <CapacityBar used={totalPallets} total={capacidadTotal > 0 ? capacidadTotal : undefined} />
              {capacidadTotal === 0 && (
                <p className="text-xs text-gray-500">Asigná choferes con camiones para ver la capacidad total.</p>
              )}
            </div>
          )}

          {/* Configure button */}
          <button
            onClick={(e) => { e.stopPropagation(); onConfigure() }}
            className="text-xs text-accent/70 hover:text-accent transition-colors"
          >
            ⚙ Configurar u/pallet
          </button>
        </div>
      )}
    </div>
  )
}

// ── ProxCard ──────────────────────────────────────────────────────────────────

function ProxCard({
  chofer,
  choferOrders,
  visitaClientes,
  allUsers,
  programasDay,
  visitasDay,
  selectedStr,
  onAdded,
}: {
  chofer:          UserProfile
  choferOrders:    Order[]
  visitaClientes:  UserProfile[]
  allUsers:        UserProfile[]
  programasDay:    ReturnType<typeof programasParaFecha>
  visitasDay:      ReturnType<typeof visitasParaFecha>
  selectedStr:     string
  onAdded:         () => void
}) {
  const [adding, setAdding] = useState<string | null>(null)

  const orderStops = choferOrders.flatMap((o) => {
    const prof = allUsers.find((u) => u.uid === o.clientId)
    const addr = getPrimaryAddress(prof!)
    if (!addr?.lat || !addr?.lng) return []
    return [{ lat: addr.lat, lng: addr.lng }]
  })

  if (orderStops.length === 0) return null

  const scheduledIds = new Set([
    ...programasDay.map((p) => p.clientId),
    ...visitasDay.map((v) => v.clientId),
  ])

  const nearby = visitaClientes
    .filter((vc) => !scheduledIds.has(vc.uid))
    .flatMap((vc) => {
      const addr = getPrimaryAddress(vc)
      if (!addr?.lat || !addr?.lng) return []
      const minDist = Math.min(...orderStops.map((s) => haversineKm(s.lat, s.lng, addr.lat!, addr.lng!)))
      if (minDist > 2) return []
      return [{ cliente: vc, distKm: Math.round(minDist * 10) / 10 }]
    })
    .sort((a, b) => a.distKm - b.distKm)

  if (nearby.length === 0) return null

  const handleAdd = async (vc: UserProfile) => {
    setAdding(vc.uid)
    try {
      const addr = getPrimaryAddress(vc)
      await addVisitaPuntual({
        clientId:      vc.uid,
        clientName:    clientLabel(vc),
        clientAddress: addr?.address || (vc as any).address || '',
        clientPhone:   vc.telefono || vc.phone || '',
        fecha:         Timestamp.fromDate(new Date(`${selectedStr}T12:00:00`)),
        driverId:      chofer.email,
        status:        'pendiente',
      })
      onAdded()
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-violet-700">
        📍 Clientes visita en la zona de {chofer.nombreContacto || chofer.nombre}
      </p>
      <div className="space-y-2">
        {nearby.map(({ cliente, distKm }) => (
          <div key={cliente.uid} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{clientLabel(cliente)}</p>
              <p className="text-xs text-gray-500">
                {distKm} km · {cliente.frecuenciaVisita ?? '—'}
              </p>
            </div>
            <button
              disabled={adding === cliente.uid}
              onClick={() => handleAdd(cliente)}
              className="text-xs text-violet-600 border border-violet-300 hover:border-violet-500 hover:bg-violet-100 rounded-lg px-3 py-1.5 transition-colors shrink-0 disabled:opacity-50"
            >
              {adding === cliente.uid ? '…' : '+ Asignar visita'}
            </button>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400">Clientes con visita periódica dentro de 2 km de la ruta</p>
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────────

export default function PlanificacionPage() {
  const days                          = next7Days()
  const [viewMode, setViewMode]         = useState<'semana' | 'dia'>('semana')
  const [selectedIdx, setSelectedIdx]   = useState(0)
  const [pedidoManual,   setPedidoManual]   = useState(false)
  const [palletConfig,   setPalletConfig]   = useState(false)
  const [allUsers,       setAllUsers]       = useState<UserProfile[]>([])
  const [asignaciones,   setAsignaciones]   = useState<AsignacionesDia>({})

  const { orders,   loading: loadO } = useAllOrders()
  const { choferes, loading: loadC } = useChoferes()
  const { camiones, loading: loadF } = useFlota()
  const { catalogo }                  = useCatalogo()
  const { programas }                 = useProgramasVisita()
  const { visitas }                   = useVisitasPuntuales()

  useEffect(() => { getAllUsers().then(setAllUsers) }, [])

  const visitaClientes = useMemo(
    () => allUsers.filter((u) => u.rol === 'cliente' && u.esVisita),
    [allUsers],
  )

  const ayudantes = useMemo(
    () => choferes.filter((c) => c.subrol === 'ayudante'),
    [choferes],
  )

  const handleAsignacion = async (choferEmail: string, camionId: string | null, ayudanteEmail: string | null) => {
    const updated = { camionId, ayudanteEmail }
    setAsignaciones((prev) => ({ ...prev, [choferEmail]: updated }))
    await setAsignacionChofer(selectedStr, choferEmail, updated)
  }

  const loading = loadO || loadC || loadF

  const goToDay = (idx: number) => { setSelectedIdx(idx); setViewMode('dia') }

  const selectedDay = days[selectedIdx]
  const selectedStr = dateToStr(selectedDay)

  useEffect(() => { getAsignacionesDia(selectedStr).then(setAsignaciones) }, [selectedStr])

  const dayStrs = useMemo(() => new Set(days.map(dateToStr)), [days])

  const ordersDay = useMemo(
    () => orders.filter((o) => orderDateStr(o) === selectedStr && !['entregado', 'cancelado'].includes(o.status)),
    [orders, selectedStr],
  )

  const programasDay = useMemo(() => programasParaFecha(programas, selectedDay), [programas, selectedDay])
  const visitasDay   = useMemo(() => visitasParaFecha(visitas, selectedDay),     [visitas, selectedDay])

  const weekTotal = useMemo(
    () => orders.filter((o) => dayStrs.has(orderDateStr(o)) && !['entregado', 'cancelado'].includes(o.status)),
    [orders, dayStrs],
  )
  const weekUnidades = useMemo(
    () => weekTotal.reduce((sum, o) => o.products.reduce((s, p) => s + p.quantity, sum), 0),
    [weekTotal],
  )

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-3xl mx-auto p-4 space-y-5 pb-10">

        {/* Header */}
        <div className="flex flex-wrap justify-between items-end gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Planificación</h1>
            {viewMode === 'semana' ? (
              <p className="text-gray-500 text-sm">
                {weekTotal.length} pedidos · {weekUnidades.toLocaleString('es-AR')} unidades esta semana
              </p>
            ) : (
              <p className="text-gray-500 text-sm">{dayFull(selectedDay)}</p>
            )}
          </div>

          {/* Toggle vista */}
          <div className="flex rounded-lg border border-[#D3D1C7] overflow-hidden text-sm">
            <button
              onClick={() => setViewMode('semana')}
              className={`px-3 py-1.5 transition-colors ${viewMode === 'semana' ? 'bg-accent text-white font-semibold' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Semana
            </button>
            <button
              onClick={() => setViewMode('dia')}
              className={`px-3 py-1.5 transition-colors ${viewMode === 'dia' ? 'bg-accent text-white font-semibold' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Día
            </button>
          </div>
        </div>

        {/* ── VISTA SEMANA ─────────────────────────────────────────────────── */}
        {viewMode === 'semana' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {days.map((d, i) => (
              <WeekCard
                key={dateToStr(d)}
                day={d}
                idx={i}
                orders={orders}
                choferes={choferes}
                camiones={camiones}
                catalogo={catalogo}
                programas={programas as any}
                visitas={visitas as any}
                onSelect={goToDay}
              />
            ))}
          </div>
        )}

        {/* ── VISTA DÍA ────────────────────────────────────────────────────── */}
        {viewMode === 'dia' && (
          <div className="space-y-4">
            {/* Botón pedido manual */}
            <div className="flex justify-end">
              <button
                onClick={() => setPedidoManual(true)}
                className="flex items-center gap-1.5 text-sm text-accent border border-accent/40 hover:bg-accent/10 rounded-xl px-4 py-2 transition-colors"
              >
                + Pedido manual
              </button>
            </div>

            {/* Tabs días */}
            <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
              {days.map((d, i) => {
                const str        = dateToStr(d)
                const dayOrders  = orders.filter((o) => orderDateStr(o) === str && !['entregado', 'cancelado'].includes(o.status))
                const count      = dayOrders.length
                const hasOverload = choferes.some((c) => {
                  const camion   = camiones.find((cam) => cam.id === c.camionId)
                  if (!camion?.capacidadPallets) return false
                  const pallets  = dayOrders.filter((o) => o.driverId === c.email).reduce((s, o) => s + calcPallets(o.products, catalogo), 0)
                  return pallets > camion.capacidadPallets
                })
                return (
                  <button
                    key={str}
                    onClick={() => setSelectedIdx(i)}
                    className={`relative flex-shrink-0 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                      i === selectedIdx
                        ? 'bg-accent text-white border-accent'
                        : 'bg-white border-[#D3D1C7] text-gray-500 hover:text-gray-900 hover:border-accent/50'
                    }`}
                  >
                    {hasOverload && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-bg" title="Sobrecarga" />
                    )}
                    <span className="block font-semibold">{dayShort(d, i)}</span>
                    <span className="block mt-0.5 opacity-80">
                      {d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                      {count > 0 && ` · ${count}`}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Banner: clientes visita sin programar esta semana */}
            {visitaClientes.length > 0 && (() => {
              const [wStart, wEnd] = thisWeekRange()
              const sinProgramar = visitaClientes.filter((vc) => {
                if (programas.some((p) => p.clientId === vc.uid && p.activo)) return false
                return !visitas.some((v) => {
                  if (v.clientId !== vc.uid) return false
                  const d = (v.fecha as Timestamp)?.toDate?.() ?? new Date(((v.fecha as any).seconds) * 1000)
                  return d >= wStart && d <= wEnd
                })
              })
              if (sinProgramar.length === 0) return null
              return (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
                  <span className="text-amber-600 shrink-0">⚠</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-700">
                      {sinProgramar.length} cliente{sinProgramar.length !== 1 ? 's' : ''} visita sin programar esta semana
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {sinProgramar.map(clientLabel).join(', ')}
                    </p>
                  </div>
                </div>
              )
            })()}

            {ordersDay.length === 0 && programasDay.length === 0 && visitasDay.length === 0 ? (
              <div className="bg-white border border-[#D3D1C7] rounded-xl p-10 text-center">
                <p className="text-3xl mb-3">📭</p>
                <p className="text-gray-500 text-sm">No hay pedidos ni visitas para este día</p>
              </div>
            ) : (
              <>
                {/* Mapa */}
                <DayMap
                  orders={ordersDay}
                  visitas={visitasDay}
                  programas={programasDay}
                  choferes={choferes}
                  allClients={allUsers}
                  onAddVisita={async (client, driverId) => {
                    const addr = getPrimaryAddress(client)
                    await addVisitaPuntual({
                      clientId:      client.uid,
                      clientName:    client.nombre || client.nombreContacto || client.email,
                      clientAddress: addr?.address || (client as any).address || '',
                      clientPhone:   client.telefono || client.phone || '',
                      fecha:         Timestamp.fromDate(new Date(`${selectedStr}T12:00:00`)),
                      driverId:      driverId || '',
                      status:        'pendiente',
                    })
                  }}
                  onDeleteVisita={async (visitaId) => {
                    await deleteVisitaPuntual(visitaId)
                  }}
                />

                {/* Sin asignar */}
                <SinAsignarCard orders={ordersDay.filter((o) => !o.driverId)} choferes={choferes} />

                {/* Pallets del día */}
                <PalletSummary
                  orders={ordersDay}
                  catalogo={catalogo}
                  camiones={camiones}
                  choferes={choferes}
                  onConfigure={() => setPalletConfig(true)}
                />

                {/* Por chofer */}
                {choferes.filter((c) => c.subrol !== 'ayudante').map((chofer) => {
                  const choferOrders = ordersDay.filter((o) => o.driverId === chofer.email)
                  const asignacion   = asignaciones[chofer.email] ?? { camionId: chofer.camionId ?? null, ayudanteEmail: null }
                  return (
                    <div key={chofer.uid} className="space-y-2">
                      <ChoferCard
                        chofer={chofer}
                        camion={camiones.find((c) => c.id === chofer.camionId)}
                        orders={choferOrders}
                        visitas={visitasDay.filter((v) => !v.driverId || v.driverId === chofer.email)}
                        programas={programasDay.filter((p) => !p.driverId || p.driverId === chofer.email)}
                        catalogo={catalogo}
                        choferes={choferes}
                        camiones={camiones}
                        ayudantes={ayudantes}
                        asignacion={asignacion}
                        onAsignacionChange={(camionId, ayudanteEmail) => handleAsignacion(chofer.email, camionId, ayudanteEmail)}
                      />
                      {choferOrders.length > 0 && visitaClientes.length > 0 && (
                        <ProxCard
                          chofer={chofer}
                          choferOrders={choferOrders}
                          visitaClientes={visitaClientes}
                          allUsers={allUsers}
                          programasDay={programasDay}
                          visitasDay={visitasDay}
                          selectedStr={selectedStr}
                          onAdded={() => {}}
                        />
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
      </main>

      <PedidoManualModal
        open={pedidoManual}
        onClose={() => setPedidoManual(false)}
        defaultDate={selectedStr}
      />

      <PalletConfigModal
        open={palletConfig}
        onClose={() => setPalletConfig(false)}
        catalogo={catalogo}
      />
    </div>
  )
}
