import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { GoogleMap, Marker, InfoWindow, Polyline } from '@react-google-maps/api'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAllOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { subscribeAllActiveDrivers, ActiveDriver } from '../../services/locationService'
import { summarizeProducts } from '../../utils/helpers'
import { Order, UserProfile } from '../../types'

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
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function orderDateStr(o: Order): string {
  if (!o.date?.toDate) return ''
  return o.date.toDate().toISOString().split('T')[0]
}

function driverColor(email: string, choferes: UserProfile[]): string {
  const idx = choferes.findIndex((c) => c.email === email)
  return idx >= 0 ? DRIVER_COLORS[idx % DRIVER_COLORS.length] : '#F59E0B'
}

function gpsAge(timestamp?: number): string {
  if (!timestamp) return 'Sin GPS'
  const mins = Math.floor((Date.now() - timestamp) / 60000)
  if (mins < 1)   return 'Ahora mismo'
  if (mins === 1) return 'Hace 1 min'
  if (mins < 60)  return `Hace ${mins} min`
  return `Hace ${Math.floor(mins / 60)}h`
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

// ── DriverCard (solo lectura) ─────────────────────────────────────────────────

function DriverCard({
  chofer, driver, orders, color, isSelected, onSelect,
}: {
  chofer:     UserProfile | null
  driver:     ActiveDriver | null
  orders:     Order[]
  color:      string
  isSelected: boolean
  onSelect:   () => void
}) {
  const nombre    = chofer?.nombreContacto || chofer?.nombre || driver?.nombreChofer || 'Sin nombre'
  const active    = orders.filter((o) => o.status !== 'cancelado')
  const delivered = active.filter((o) => o.status === 'entregado').length
  const total     = active.length
  const pct       = total > 0 ? Math.round((delivered / total) * 100) : 0
  const pending   = active.filter((o) => !['entregado', 'cancelado'].includes(o.status))

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-xl border transition-all p-4 ${
        isSelected ? 'border-accent bg-accent/10' : 'border-[#D3D1C7] bg-white hover:border-accent/40'
      }`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold mt-0.5"
          style={{ backgroundColor: color }}
        >
          {nombre.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm truncate text-gray-900">{nombre}</p>
          <p className={`text-xs mt-0.5 ${driver ? 'text-gray-400' : 'text-amber-500'}`}>
            {driver ? `📍 ${gpsAge(driver.timestamp)}` : '📍 GPS no activo'}
          </p>
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
      <p className="text-xs text-gray-500">{pct}% completado · {pending.length} pendiente{pending.length !== 1 ? 's' : ''}</p>
    </button>
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

  if (!isLoaded) return <div className="flex-1 bg-[#F8F7F2] animate-pulse" />

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
                    <p style={{ margin: 0, fontWeight: 600, textTransform: 'uppercase',
                      color: isDone ? '#10b981' : isCanceled ? '#6b7280' : sColor }}>
                      {o.status}
                    </p>
                  </div>
                </InfoWindow>
              )}
            </Marker>
          )
        })
      })}

      {/* Línea punteada hacia pendientes */}
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

      {/* GPS pins de choferes */}
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

// ── Página principal ──────────────────────────────────────────────────────────

export default function MapaLivePage() {
  const { orders,   loading: loadO } = useAllOrders()
  const { choferes, loading: loadC } = useChoferes()
  const [activeDrivers, setActiveDrivers]   = useState<ActiveDriver[]>([])
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null)

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
      chofer: choferes.find((c) => c.email === email) ?? null,
      driver: activeDrivers.find((d) => d.email === email) ?? null,
      orders: ordersToday.filter((o) => o.driverId === email),
      color:  driverColor(email, choferes),
    }))
  }, [ordersToday, choferes, activeDrivers])

  const handleSelect = (email: string) =>
    setSelectedDriver((prev) => (prev === email ? null : email))

  const totalEntregados = ordersToday.filter((o) => o.status === 'entregado').length
  const totalPendientes = ordersToday.filter((o) => o.driverId && !['entregado', 'cancelado'].includes(o.status)).length

  if (loadO || loadC) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <>
      <Navbar />
      <div className="flex" style={{ height: 'calc(100vh - 56px)' }}>

        {/* Sidebar */}
        <aside className="w-64 shrink-0 bg-white border-r border-[#D3D1C7] flex flex-col overflow-hidden">

          <div className="p-4 border-b border-[#D3D1C7]">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <h1 className="text-base font-bold text-gray-900">Reparto en vivo</h1>
            </div>
            <p className="text-xs text-gray-500">
              {totalEntregados} entregados · {totalPendientes} pendientes
            </p>
          </div>

          {/* Leyenda */}
          <div className="px-4 py-2.5 border-b border-[#D3D1C7] flex gap-3 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />Entregado</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-accent" />Pendiente</span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {driversToday.length === 0 && (
              <p className="text-xs text-gray-500 text-center mt-10">No hay repartos asignados hoy</p>
            )}

            {selectedDriver && (
              <button
                onClick={() => setSelectedDriver(null)}
                className="w-full text-xs text-accent border border-accent/30 rounded-xl py-2 hover:bg-accent/10 transition-colors mb-1"
              >
                ← Ver todos
              </button>
            )}

            {driversToday.map(({ email, chofer, driver, orders, color }) => (
              <DriverCard
                key={email}
                chofer={chofer}
                driver={driver}
                orders={orders}
                color={color}
                isSelected={selectedDriver === email}
                onSelect={() => handleSelect(email)}
              />
            ))}
          </div>
        </aside>

        {/* Mapa */}
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
    </>
  )
}
