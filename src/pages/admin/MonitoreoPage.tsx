import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Timestamp } from 'firebase/firestore'
import { GoogleMap, Marker, InfoWindow, Polyline } from '@react-google-maps/api'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { useAllOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { useFlota } from '../../hooks/useFlota'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { useNotifyReprogramado } from '../../hooks/useNotifications'
import { subscribeAllActiveDrivers, ActiveDriver } from '../../services/locationService'
import { rescheduleOrder, reassignOrder, assignDriver } from '../../services/orderService'
import { getPushSubscriptionByEmail } from '../../services/userService'
import { sendPush } from '../../services/notificationService'
import { Order, UserProfile, Camion, MOTIVOS_INCIDENCIA } from '../../types'
import { summarizeProducts, formatShortDate } from '../../utils/helpers'

// ── Constantes ────────────────────────────────────────────────────────────────

const DRIVER_COLORS = ['#00C2FF', '#FF6B6B', '#4ECDC4', '#A8E6CF', '#FFE66D', '#C084FC', '#F97316', '#34D399']

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

function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function driverColor(email: string, choferes: UserProfile[]): string {
  const idx = choferes.findIndex((c) => c.email === email)
  return idx >= 0 ? DRIVER_COLORS[idx % DRIVER_COLORS.length] : '#F59E0B'
}

function orderDateStr(o: Order): string {
  if (!o.date?.toDate) return ''
  return o.date.toDate().toISOString().split('T')[0]
}

function gpsAge(timestamp?: number): string {
  if (!timestamp) return 'Sin GPS'
  const mins = Math.floor((Date.now() - timestamp) / 60000)
  if (mins < 1)   return 'Ahora mismo'
  if (mins === 1) return 'Hace 1 min'
  if (mins < 60)  return `Hace ${mins} min`
  return `Hace ${Math.floor(mins / 60)}h`
}

function alertLevel(pendingCount: number): 'red' | 'yellow' | null {
  if (pendingCount === 0) return null
  const hour = new Date().getHours()
  if (hour >= 16) return 'red'
  if (hour >= 14 && pendingCount >= 3) return 'yellow'
  return null
}

function makeDriverPin(color: string, initials: string) {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44">` +
    `<circle cx="22" cy="22" r="20" fill="${color}" stroke="white" stroke-width="3"/>` +
    `<text x="22" y="27" font-size="14" font-weight="bold" text-anchor="middle" fill="white" font-family="sans-serif">${initials}</text>` +
    `</svg>`,
  )
  return { url: `data:image/svg+xml;charset=UTF-8,${svg}`, scaledSize: new google.maps.Size(44, 44), anchor: new google.maps.Point(22, 22) }
}

function makeDeliveryPin(color: string, label: string) {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36">` +
    `<path d="M14 0C6.3 0 0 6.3 0 14c0 9.6 14 22 14 22s14-12.4 14-22C28 6.3 21.7 0 14 0z" fill="${color}"/>` +
    `<text x="14" y="19" font-size="11" font-weight="bold" text-anchor="middle" fill="white" font-family="sans-serif">${label}</text>` +
    `</svg>`,
  )
  return { url: `data:image/svg+xml;charset=UTF-8,${svg}`, scaledSize: new google.maps.Size(28, 36), anchor: new google.maps.Point(14, 36) }
}

// ── ReprogramarModal ──────────────────────────────────────────────────────────

function ReprogramarModal({
  order,
  onClose,
  onDone,
}: {
  order:   Order
  onClose: () => void
  onDone:  () => void
}) {
  const [fecha,  setFecha]  = useState(tomorrow())
  const [motivo, setMotivo] = useState<string>(MOTIVOS_INCIDENCIA[0])
  const [saving, setSaving] = useState(false)
  const notifyReprogramadoMutation = useNotifyReprogramado()

  const handleSave = async () => {
    setSaving(true)
    try {
      await rescheduleOrder(order.id, fecha, motivo, {
        fechaOriginal:  order.date,
        choferOriginal: order.driverId ?? undefined,
      })
      // Notificar al cliente (fire-and-forget)
      if (order.clientEmail) {
        notifyReprogramadoMutation.mutate({
          email:      order.clientEmail,
          nombre:     order.clientName.split(' ')[0] || 'Cliente',
          products:   order.products,
          fechaNueva: fecha,
          motivo,
        })
      }
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Reprogramar entrega">
      <div className="space-y-4 text-sm">
        <div className="bg-surface border border-border rounded-lg px-3 py-2.5">
          <p className="font-medium">{order.clientName}</p>
          <p className="text-muted text-xs mt-0.5">{summarizeProducts(order.products)}</p>
          <p className="text-muted text-xs">Fecha original: {formatShortDate(order.date)}</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted">Nueva fecha de entrega</label>
          <div className="flex gap-2 items-center">
            <input
              type="date"
              value={fecha}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) => setFecha(e.target.value)}
              className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={() => setFecha(tomorrow())}
              className="text-xs text-accent border border-accent/30 rounded-lg px-3 py-2 hover:bg-accent/10 transition-colors shrink-0"
            >
              Mañana
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted">Motivo</label>
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {MOTIVOS_INCIDENCIA.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="bg-accent/5 border border-accent/20 rounded-lg px-3 py-2 text-xs text-muted">
          El cliente recibirá un email con la nueva fecha y el motivo.
        </div>
      </div>

      <div className="flex gap-3 mt-5">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button onClick={handleSave} loading={saving} className="flex-1">Reprogramar</Button>
      </div>
    </Modal>
  )
}

// ── ReasignarModal ────────────────────────────────────────────────────────────

function ReasignarModal({
  order,
  choferes,
  onClose,
  onDone,
}: {
  order:    Order
  choferes: UserProfile[]
  onClose:  () => void
  onDone:   () => void
}) {
  const otrosChoferes = choferes.filter((c) => c.email !== order.driverId)
  const [email,  setEmail]  = useState(otrosChoferes[0]?.email ?? '')
  const [motivo, setMotivo] = useState<string>(MOTIVOS_INCIDENCIA[0])
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!email) return
    setSaving(true)
    try {
      await reassignOrder(order.id, email, motivo, order.driverId ?? '')
      // Push al chofer nuevo
      getPushSubscriptionByEmail(email).then((sub) => {
        if (sub) sendPush({ subscription: sub, title: 'Pedido reasignado', body: `${order.clientName} — ${formatShortDate(order.date)}` })
      }).catch(console.error)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Reasignar a otro chofer">
      <div className="space-y-4 text-sm">
        <div className="bg-surface border border-border rounded-lg px-3 py-2.5">
          <p className="font-medium">{order.clientName}</p>
          <p className="text-muted text-xs mt-0.5">{summarizeProducts(order.products)}</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted">Asignar a</label>
          <select
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {otrosChoferes.map((c) => (
              <option key={c.email} value={c.email}>{c.nombreContacto || c.nombre}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted">Motivo</label>
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {MOTIVOS_INCIDENCIA.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-3 mt-5">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button onClick={handleSave} loading={saving} disabled={!email} className="flex-1">Reasignar</Button>
      </div>
    </Modal>
  )
}

// ── FinJornadaModal ───────────────────────────────────────────────────────────

function FinJornadaModal({
  driverEmail,
  pendingOrders,
  choferes,
  onClose,
  onDone,
}: {
  driverEmail:   string
  pendingOrders: Order[]
  choferes:      UserProfile[]
  onClose:       () => void
  onDone:        () => void
}) {
  const [accion, setAccion]  = useState<'reprogramar' | 'reasignar'>('reprogramar')
  const [fecha,  setFecha]   = useState(tomorrow())
  const [email,  setEmail]   = useState('')
  const [motivo, setMotivo]  = useState<string>(MOTIVOS_INCIDENCIA[0])
  const [saving, setSaving]  = useState(false)
  const notifyReprogramadoMutation = useNotifyReprogramado()
  const otrosChoferes = choferes.filter((c) => c.email !== driverEmail)

  const handleConfirm = async () => {
    setSaving(true)
    try {
      await Promise.all(
        pendingOrders.map(async (o) => {
          if (accion === 'reprogramar') {
            await rescheduleOrder(o.id, fecha, motivo, { fechaOriginal: o.date, choferOriginal: driverEmail })
            if (o.clientEmail) {
              notifyReprogramadoMutation.mutate({
                email: o.clientEmail, nombre: o.clientName.split(' ')[0] || 'Cliente',
                products: o.products, fechaNueva: fecha, motivo,
              })
            }
          } else {
            if (!email) return
            await reassignOrder(o.id, email, motivo, driverEmail)
          }
        }),
      )
      if (accion === 'reasignar' && email) {
        getPushSubscriptionByEmail(email).then((sub) => {
          if (sub) sendPush({ subscription: sub, title: `${pendingOrders.length} pedidos reasignados`, body: 'Revisá tus entregas' })
        }).catch(console.error)
      }
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const chofer = choferes.find((c) => c.email === driverEmail)
  const nombre = chofer?.nombreContacto || chofer?.nombre || driverEmail

  return (
    <Modal open onClose={onClose} title="Fin de jornada">
      <div className="space-y-4 text-sm">
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3">
          <p className="font-semibold text-yellow-400">{nombre}</p>
          <p className="text-yellow-400/70 text-xs mt-0.5">
            Quedan <strong>{pendingOrders.length}</strong> entrega{pendingOrders.length !== 1 ? 's' : ''} sin completar
          </p>
        </div>

        {/* Lista de pendientes */}
        <div className="space-y-1.5 max-h-36 overflow-y-auto">
          {pendingOrders.map((o) => (
            <div key={o.id} className="flex items-center gap-2 text-xs text-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
              <span className="font-medium text-white truncate">{o.clientName}</span>
              <span className="truncate">{summarizeProducts(o.products)}</span>
            </div>
          ))}
        </div>

        {/* Acción */}
        <div className="flex rounded-xl border border-border overflow-hidden text-xs">
          <button
            onClick={() => setAccion('reprogramar')}
            className={`flex-1 py-2.5 font-medium transition-colors ${accion === 'reprogramar' ? 'bg-accent text-bg' : 'text-muted hover:text-white'}`}
          >
            📅 Reprogramar todos
          </button>
          <button
            onClick={() => setAccion('reasignar')}
            className={`flex-1 py-2.5 font-medium transition-colors ${accion === 'reasignar' ? 'bg-accent text-bg' : 'text-muted hover:text-white'}`}
          >
            🔄 Reasignar todos
          </button>
        </div>

        {accion === 'reprogramar' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted">Nueva fecha</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={fecha}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setFecha(e.target.value)}
                className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={() => setFecha(tomorrow())}
                className="text-xs text-accent border border-accent/30 rounded-lg px-3 py-2 hover:bg-accent/10 transition-colors shrink-0"
              >
                Mañana
              </button>
            </div>
          </div>
        )}

        {accion === 'reasignar' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted">Asignar a</label>
            <select
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Seleccioná un chofer…</option>
              {otrosChoferes.map((c) => (
                <option key={c.email} value={c.email}>{c.nombreContacto || c.nombre}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted">Motivo</label>
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {MOTIVOS_INCIDENCIA.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {accion === 'reprogramar' && (
          <p className="text-xs text-muted/70">Los clientes recibirán un email con la nueva fecha.</p>
        )}
      </div>

      <div className="flex gap-3 mt-5">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button
          onClick={handleConfirm}
          loading={saving}
          disabled={accion === 'reasignar' && !email}
          className="flex-1"
        >
          Confirmar
        </Button>
      </div>
    </Modal>
  )
}

// ── DriverSideCard ────────────────────────────────────────────────────────────

function DriverSideCard({
  chofer, camion, driver, orders, color, isSelected, onSelect,
  onReprogramar, onReasignar, onFinJornada,
}: {
  chofer:        UserProfile | null
  camion:        Camion | undefined
  driver:        ActiveDriver | null
  orders:        Order[]
  color:         string
  isSelected:    boolean
  onSelect:      () => void
  onReprogramar: (order: Order) => void
  onReasignar:   (order: Order) => void
  onFinJornada:  () => void
}) {
  const nombre    = chofer?.nombreContacto || chofer?.nombre || driver?.nombreChofer || 'Sin nombre'
  const active    = orders.filter((o) => o.status !== 'cancelado')
  const delivered = active.filter((o) => o.status === 'entregado').length
  const total     = active.length
  const pending   = active.filter((o) => o.status !== 'entregado')
  const pct       = total > 0 ? Math.round((delivered / total) * 100) : 0
  const alert     = alertLevel(pending.length)

  return (
    <div
      className={`rounded-xl border transition-all ${
        isSelected ? 'border-accent bg-accent/10' : 'border-[#D3D1C7] bg-white'
      }`}
    >
      {/* Header clickeable */}
      <button onClick={onSelect} className="w-full text-left p-4">
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold mt-0.5"
            style={{ backgroundColor: color }}
          >
            {nombre.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm truncate text-gray-900">{nombre}</p>
            {camion ? (
              <p className="text-xs text-gray-500">🚛 {camion.patente}</p>
            ) : (
              <p className="text-xs text-amber-600">Sin camión</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="font-bold text-lg leading-none" style={{ color }}>{delivered}</p>
            <p className="text-xs text-gray-500">/ {total}</p>
          </div>
        </div>

        {/* Barra de progreso */}
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-1.5">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#10b981' : color }}
          />
        </div>

        {/* Alerta temprana */}
        {alert === 'red' && (
          <p className="text-xs font-semibold text-red-400 mt-1">
            🚨 {pending.length} pendiente{pending.length !== 1 ? 's' : ''} — fuera de horario
          </p>
        )}
        {alert === 'yellow' && (
          <p className="text-xs font-semibold text-yellow-400 mt-1">
            ⚠ {pending.length} pendientes — quedan pocas horas
          </p>
        )}
        {!alert && (
          <p className="text-xs text-gray-500">{pct}% completado</p>
        )}

        <p className={`text-xs mt-1 ${driver ? 'text-gray-400' : 'text-amber-500'}`}>
          {driver ? `📍 ${gpsAge(driver.timestamp)}` : '📍 GPS no activo aún'}
        </p>
      </button>

      {/* Detalle expandido cuando está seleccionado */}
      {isSelected && pending.length > 0 && (
        <div className="border-t border-gray-200 px-4 pb-4 pt-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Pendientes ({pending.length})
          </p>

          {pending.map((o) => (
            <div key={o.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate text-gray-900">{o.clientName}</p>
                <p className="text-xs text-gray-500 truncate">{summarizeProducts(o.products)}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => onReprogramar(o)}
                  className="text-xs text-accent border border-accent/30 rounded-lg px-2 py-1 hover:bg-accent/10 transition-colors"
                  title="Reprogramar"
                >
                  📅
                </button>
                <button
                  onClick={() => onReasignar(o)}
                  className="text-xs text-gray-500 border border-[#D3D1C7] rounded-lg px-2 py-1 hover:border-accent/40 hover:text-gray-900 transition-colors"
                  title="Reasignar"
                >
                  🔄
                </button>
              </div>
            </div>
          ))}

          {/* Fin de jornada bulk */}
          <button
            onClick={onFinJornada}
            className="w-full mt-1 text-xs font-medium text-amber-600 border border-amber-300 rounded-xl py-2 hover:bg-amber-50 transition-colors"
          >
            Fin de jornada — gestionar todos
          </button>
        </div>
      )}

      {isSelected && pending.length === 0 && total > 0 && (
        <div className="border-t border-gray-200 px-4 py-3">
          <p className="text-xs text-success font-medium text-center">Todas las entregas completadas</p>
        </div>
      )}
    </div>
  )
}

// ── LiveMap ───────────────────────────────────────────────────────────────────

function LiveMap({
  activeDrivers, ordersToday, choferes, selectedDriver, onSelectDriver,
}: {
  activeDrivers:  ActiveDriver[]
  ordersToday:    Order[]
  choferes:       UserProfile[]
  selectedDriver: string | null
  onSelectDriver: (email: string) => void
}) {
  const { isLoaded }    = useGoogleMapsLoader()
  const mapRef          = useRef<google.maps.Map | null>(null)
  const geocacheRef     = useRef<Map<string, { lat: number; lng: number } | null>>(new Map())
  const [geocoded, setGeocoded]             = useState<Map<string, { lat: number; lng: number } | null>>(new Map())
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null)

  const addresses = useMemo(
    () => [...new Set(ordersToday.map((o) => o.clientAddress).filter(Boolean))],
    [ordersToday],
  )

  const geocodeAll = useCallback(() => {
    if (!isLoaded || addresses.length === 0) return
    const pending = addresses.filter((a) => !geocacheRef.current.has(a))
    if (pending.length === 0) { setGeocoded(new Map(geocacheRef.current)); return }
    const geocoder = new google.maps.Geocoder()
    Promise.all(
      pending.map((addr) =>
        new Promise<void>((resolve) => {
          geocoder.geocode(
            { address: `${addr}, Argentina`, componentRestrictions: { country: 'AR' } },
            (results, status) => {
              const pt = status === 'OK' && results?.[0]
                ? { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() }
                : null
              geocacheRef.current.set(addr, pt)
              resolve()
            },
          )
        }),
      ),
    ).then(() => setGeocoded(new Map(geocacheRef.current)))
  }, [isLoaded, addresses])

  useEffect(() => { geocodeAll() }, [geocodeAll])

  useEffect(() => {
    if (!mapRef.current) return
    if (selectedDriver) {
      const d = activeDrivers.find((d) => d.email === selectedDriver)
      if (d) { mapRef.current.panTo({ lat: d.lat, lng: d.lng }); mapRef.current.setZoom(14) }
      return
    }
    if (activeDrivers.length === 0) return
    if (activeDrivers.length === 1) {
      mapRef.current.panTo({ lat: activeDrivers[0].lat, lng: activeDrivers[0].lng })
      mapRef.current.setZoom(13)
      return
    }
    const bounds = new google.maps.LatLngBounds()
    activeDrivers.forEach((d) => bounds.extend({ lat: d.lat, lng: d.lng }))
    mapRef.current.fitBounds(bounds, 80)
  }, [activeDrivers, selectedDriver])

  const ordersByDriver = useMemo(() => {
    const map: Record<string, Order[]> = {}
    for (const o of ordersToday) {
      if (!o.driverId) continue
      if (!map[o.driverId]) map[o.driverId] = []
      map[o.driverId].push(o)
    }
    return map
  }, [ordersToday])

  if (!isLoaded) return <div className="flex-1 bg-bg animate-pulse" />

  const visibleDriverEmails = selectedDriver ? [selectedDriver] : Object.keys(ordersByDriver)

  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height: '100%' }}
      center={{ lat: -34.6037, lng: -58.3816 }}
      zoom={12}
      options={{ disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy', styles: DARK_MAP_STYLES }}
      onLoad={(m) => { mapRef.current = m }}
    >
      {/* Marcadores de entrega */}
      {visibleDriverEmails.map((email) => {
        const orders = ordersByDriver[email] ?? []
        const color  = driverColor(email, choferes)
        let stopNum  = 0
        return orders.map((o) => {
          const pt = geocoded.get(o.clientAddress)
          if (!pt) return null
          const isDone     = o.status === 'entregado'
          const isCanceled = o.status === 'cancelado'
          if (!isDone && !isCanceled) stopNum++
          const label  = isDone ? '✓' : isCanceled ? '✗' : String(stopNum)
          const sColor = isDone ? '#10b981' : isCanceled ? '#6b7280' : color
          return (
            <Marker
              key={o.id}
              position={pt}
              icon={makeDeliveryPin(sColor, label)}
              opacity={isCanceled ? 0.35 : 1}
              zIndex={isDone ? 1 : 5}
              onClick={() => setSelectedMarker((s) => (s === o.id ? null : o.id))}
            >
              {selectedMarker === o.id && (
                <InfoWindow onCloseClick={() => setSelectedMarker(null)}>
                  <div style={{ color: '#111', minWidth: 160, fontSize: 13, lineHeight: 1.6 }}>
                    <p style={{ margin: '0 0 2px', fontWeight: 700 }}>{o.clientName}</p>
                    <p style={{ margin: '0 0 4px', color: '#555' }}>{summarizeProducts(o.products)}</p>
                    {o.horaEntrega && <p style={{ margin: '0 0 4px', color: '#555' }}>🕐 {o.horaEntrega} hs</p>}
                    <p style={{ margin: 0, color: sColor, fontWeight: 600, textTransform: 'uppercase' }}>{o.status}</p>
                  </div>
                </InfoWindow>
              )}
            </Marker>
          )
        })
      })}

      {/* Línea de ruta punteada hacia pendientes */}
      {activeDrivers
        .filter((d) => !selectedDriver || d.email === selectedDriver)
        .map((driver) => {
          const color   = driverColor(driver.email, choferes)
          const pending = (ordersByDriver[driver.email] ?? [])
            .filter((o) => !['entregado', 'cancelado'].includes(o.status))
            .map((o) => geocoded.get(o.clientAddress))
            .filter(Boolean) as { lat: number; lng: number }[]
          if (pending.length === 0) return null
          const path = [{ lat: driver.lat, lng: driver.lng }, ...pending]
          return (
            <Polyline
              key={`route-${driver.email}`}
              path={path}
              options={{
                strokeColor: color, strokeOpacity: 0, strokeWeight: 3,
                icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, scale: 3, strokeColor: color }, offset: '0', repeat: '14px' }],
              }}
            />
          )
        })}

      {/* Marcadores GPS de choferes */}
      {activeDrivers.map((driver) => {
        const color    = driverColor(driver.email, choferes)
        const chofer   = choferes.find((c) => c.email === driver.email)
        const initials = (chofer?.nombreContacto || chofer?.nombre || driver.nombreChofer || '?')
          .split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
        const dimmed   = selectedDriver && selectedDriver !== driver.email
        return (
          <Marker
            key={`gps-${driver.email}`}
            position={{ lat: driver.lat, lng: driver.lng }}
            icon={makeDriverPin(color, initials)}
            opacity={dimmed ? 0.25 : 1}
            zIndex={1000}
            onClick={() => { onSelectDriver(driver.email); setSelectedMarker(`gps-${driver.email}`) }}
          >
            {selectedMarker === `gps-${driver.email}` && (
              <InfoWindow onCloseClick={() => setSelectedMarker(null)}>
                <div style={{ color: '#111', minWidth: 140, fontSize: 13, lineHeight: 1.6 }}>
                  <p style={{ margin: '0 0 2px', fontWeight: 700 }}>{chofer?.nombreContacto || chofer?.nombre || driver.nombreChofer}</p>
                  <p style={{ margin: 0, color: '#555' }}>📍 {gpsAge(driver.timestamp)}</p>
                </div>
              </InfoWindow>
            )}
          </Marker>
        )
      })}
    </GoogleMap>
  )
}

// ── Página principal ───────────────────────────────────────────────────────────

export default function MonitoreoPage() {
  const { orders,   loading: loadO } = useAllOrders()
  const { choferes, loading: loadC } = useChoferes()
  const { camiones, loading: loadF } = useFlota()
  const [activeDrivers, setActiveDrivers]   = useState<ActiveDriver[]>([])
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null)
  const [reprogramarOrder, setReprogramarOrder] = useState<Order | null>(null)
  const [reasignarOrder,   setReasignarOrder]   = useState<Order | null>(null)
  const [finJornadaEmail,  setFinJornadaEmail]  = useState<string | null>(null)

  useEffect(() => subscribeAllActiveDrivers(setActiveDrivers), [])

  const today = useMemo(() => new Date().toISOString().split('T')[0], [])

  const ordersToday = useMemo(
    () => orders.filter((o) => orderDateStr(o) === today),
    [orders, today],
  )

  const driversToday = useMemo(() => {
    const emails = [...new Set(ordersToday.filter((o) => o.driverId).map((o) => o.driverId!))]
    return emails.map((email) => ({
      email,
      chofer:  choferes.find((c) => c.email === email) ?? null,
      camion:  choferes.find((c) => c.email === email)
               ? camiones.find((c) => c.id === choferes.find((ch) => ch.email === email)!.camionId)
               : undefined,
      driver:  activeDrivers.find((d) => d.email === email) ?? null,
      orders:  ordersToday.filter((o) => o.driverId === email),
      color:   driverColor(email, choferes),
    }))
  }, [ordersToday, choferes, camiones, activeDrivers])

  const handleSelect = (email: string) =>
    setSelectedDriver((prev) => (prev === email ? null : email))

  const finJornadaOrders = finJornadaEmail
    ? ordersToday.filter((o) => o.driverId === finJornadaEmail && !['entregado', 'cancelado'].includes(o.status))
    : []

  if (loadO || loadC || loadF) return <><Navbar /><LoadingSpinner fullScreen /></>

  const totalEntregados = ordersToday.filter((o) => o.status === 'entregado').length
  const totalPendientes = ordersToday.filter((o) => o.driverId && !['entregado', 'cancelado'].includes(o.status)).length

  return (
    <>
      <Navbar />
      <div className="flex" style={{ height: 'calc(100vh - 56px)' }}>

        {/* ── Sidebar ───────────────────────────────────────────────────────── */}
        <aside className="w-72 shrink-0 bg-white border-r border-[#D3D1C7] flex flex-col overflow-hidden">

          <div className="p-4 border-b border-[#D3D1C7]">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <h1 className="text-base font-bold text-gray-900">Monitoreo en vivo</h1>
            </div>
            <p className="text-xs text-gray-500">
              {totalEntregados} entregados · {totalPendientes} pendientes · {activeDrivers.length} con GPS
            </p>
          </div>

          <div className="px-4 py-2.5 border-b border-[#D3D1C7] flex gap-3 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#4b5563]" />Pendiente</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-accent" />En camino</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-success" />Entregado</span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {driversToday.length === 0 && (
              <p className="text-xs text-gray-500 text-center mt-10">No hay choferes con pedidos asignados hoy</p>
            )}

            {selectedDriver && (
              <button
                onClick={() => setSelectedDriver(null)}
                className="w-full text-xs text-accent border border-accent/30 rounded-xl py-2 hover:bg-accent/10 transition-colors mb-1"
              >
                ← Ver todos
              </button>
            )}

            {driversToday.map(({ email, chofer, camion, driver, orders, color }) => (
              <DriverSideCard
                key={email}
                chofer={chofer}
                camion={camion}
                driver={driver}
                orders={orders}
                color={color}
                isSelected={selectedDriver === email}
                onSelect={() => handleSelect(email)}
                onReprogramar={(o) => setReprogramarOrder(o)}
                onReasignar={(o) => setReasignarOrder(o)}
                onFinJornada={() => setFinJornadaEmail(email)}
              />
            ))}
          </div>
        </aside>

        {/* ── Mapa ──────────────────────────────────────────────────────────── */}
        <div className="flex-1 relative">
          {activeDrivers.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="bg-white/95 border border-[#D3D1C7] rounded-xl px-6 py-5 text-center shadow-xl">
                <p className="text-3xl mb-3">📡</p>
                <p className="text-sm font-semibold text-gray-900">Sin choferes activos</p>
                <p className="text-xs text-gray-500 mt-1 max-w-[200px]">El GPS se activa cuando el chofer comienza el reparto</p>
              </div>
            </div>
          )}
          <LiveMap
            activeDrivers={activeDrivers}
            ordersToday={ordersToday}
            choferes={choferes}
            selectedDriver={selectedDriver}
            onSelectDriver={handleSelect}
          />
        </div>
      </div>

      {/* ── Modales ───────────────────────────────────────────────────────────── */}
      {reprogramarOrder && (
        <ReprogramarModal
          order={reprogramarOrder}
          onClose={() => setReprogramarOrder(null)}
          onDone={() => setReprogramarOrder(null)}
        />
      )}

      {reasignarOrder && (
        <ReasignarModal
          order={reasignarOrder}
          choferes={choferes}
          onClose={() => setReasignarOrder(null)}
          onDone={() => setReasignarOrder(null)}
        />
      )}

      {finJornadaEmail && (
        <FinJornadaModal
          driverEmail={finJornadaEmail}
          pendingOrders={finJornadaOrders}
          choferes={choferes}
          onClose={() => setFinJornadaEmail(null)}
          onDone={() => setFinJornadaEmail(null)}
        />
      )}
    </>
  )
}
