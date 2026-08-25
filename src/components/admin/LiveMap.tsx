// Mapa en vivo compartido por MonitoreoPage (admin/logística, con acciones
// de reprogramar/reasignar/fin de jornada) y MapaLivePage (comercial, solo
// lectura). Antes este archivo estaba duplicado ~1:1 entre las dos páginas —
// cualquier fix al geocoding, los pines o el comportamiento del mapa había
// que aplicarlo dos veces. Lo que queda page-specific (DriverSideCard vs.
// DriverCard) es genuinamente distinto — una tiene acciones operativas, la
// otra es de solo lectura — así que no se fuerza a un único componente.
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { GoogleMap, Marker, InfoWindow, Polyline } from '@react-google-maps/api'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { ActiveDriver } from '../../services/locationService'
import { summarizeProducts } from '../../utils/helpers'
import { Order, UserProfile } from '../../types'

export const DRIVER_COLORS = ['#00C2FF', '#FF6B6B', '#4ECDC4', '#A8E6CF', '#FFE66D', '#C084FC', '#F97316', '#34D399']

// Cache de geocodificación a nivel de módulo — persiste entre montajes
const GEO_CACHE = new Map<string, { lat: number; lng: number } | null>()

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

export function driverColor(email: string, choferes: UserProfile[]): string {
  const idx = choferes.findIndex((c) => c.email === email)
  return idx >= 0 ? DRIVER_COLORS[idx % DRIVER_COLORS.length] : '#F59E0B'
}

export function gpsAge(timestamp?: number): string {
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

export function LiveMap({
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
  const geocacheRef     = useRef<Map<string, { lat: number; lng: number } | null>>(GEO_CACHE)
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
