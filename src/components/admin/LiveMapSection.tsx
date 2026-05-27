import { useState, useEffect, useRef } from 'react'
import { GoogleMap, Marker, InfoWindow } from '@react-google-maps/api'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { subscribeAllActiveDrivers, ActiveDriver } from '../../services/locationService'
import { Order } from '../../types'

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

interface LiveMapSectionProps {
  orders: Order[]
}

export function LiveMapSection({ orders }: LiveMapSectionProps) {
  const { isLoaded }            = useGoogleMapsLoader()
  const [open, setOpen]         = useState(false)
  const [drivers, setDrivers]   = useState<ActiveDriver[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const mapRef                  = useRef<google.maps.Map | null>(null)

  useEffect(() => subscribeAllActiveDrivers(setDrivers), [])

  const now = Date.now()

  const pendingByDriver = orders.reduce<Record<string, number>>((acc, o) => {
    if (o.driverId && !['entregado', 'cancelado'].includes(o.status)) {
      acc[o.driverId] = (acc[o.driverId] ?? 0) + 1
    }
    return acc
  }, {})

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

  const staleDrivers = drivers.filter((d) => d.timestamp && now - d.timestamp > STALE_MS)

  return (
    <section className="space-y-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
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
                options={{ disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative', styles: DARK_MAP_STYLES }}
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
                              <a href={`tel:${driver.telefonoChofer}`} style={{ display: 'block', marginTop: '6px', color: '#0066cc' }}>
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
                      {isStale && <p className="text-orange-400 text-xs mt-1">⚠ &gt;20 min</p>}
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
