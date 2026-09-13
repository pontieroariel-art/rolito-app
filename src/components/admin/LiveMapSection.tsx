import { useState, useEffect, useRef, useMemo } from 'react'
import { Marker, InfoWindow } from '@react-google-maps/api'
import MapaBase from '@/components/common/map/MapaBase'
import { pinCircular } from '@/components/common/map/pines'
import { subscribeAllActiveDrivers, ActiveDriver } from '../../services/locationService'
import { Order } from '../../types'

const STALE_MS   = 20 * 60 * 1000

function makeDriverIcon(pending: number, isStale: boolean) {
  return pinCircular(isStale ? '#F97316' : '#00C2FF', String(pending), { tamano: 40, grosorBorde: 2 })
}

interface LiveMapSectionProps {
  orders: Order[]
}

export function LiveMapSection({ orders }: LiveMapSectionProps) {
  const [open, setOpen]         = useState(false)
  const [drivers, setDrivers]   = useState<ActiveDriver[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const mapRef                  = useRef<google.maps.Map | null>(null)

  useEffect(() => subscribeAllActiveDrivers(setDrivers), [])

  // Fuerza un re-render periódico mientras el panel está abierto para que el
  // badge de "sin movimiento" se actualice solo con el paso del tiempo — antes
  // `now` solo se recalculaba cuando llegaba una posición GPS nueva, así que
  // un chofer que dejó de mandar GPS quedaba con el badge desactualizado.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [open])

  const now = Date.now()

  const pendingByDriver = orders.reduce<Record<string, number>>((acc, o) => {
    if (o.driverId && !['entregado', 'cancelado'].includes(o.status)) {
      acc[o.driverId] = (acc[o.driverId] ?? 0) + 1
    }
    return acc
  }, {})

  // Solo reencuadra cuando cambia el CONJUNTO de choferes activos (alguien se
  // conecta/desconecta), no en cada tick de posición GPS — antes se
  // reencuadraba con cada actualización de `drivers`, deshaciendo cualquier
  // pan/zoom manual que el admin hiciera para mirar una zona puntual.
  const driversKey = useMemo(() => drivers.map((d) => d.email).sort().join(','), [drivers])
  const prevDriversKeyRef = useRef<string>('')
  useEffect(() => {
    if (!open) { prevDriversKeyRef.current = ''; return }
    if (!mapRef.current || drivers.length === 0) return
    if (driversKey === prevDriversKeyRef.current) return
    prevDriversKeyRef.current = driversKey
    if (drivers.length === 1) {
      mapRef.current.panTo({ lat: drivers[0].lat, lng: drivers[0].lng })
      mapRef.current.setZoom(14)
      return
    }
    const bounds = new google.maps.LatLngBounds()
    drivers.forEach((d) => bounds.extend({ lat: d.lat, lng: d.lng }))
    mapRef.current.fitBounds(bounds, 80)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, driversKey])

  const staleDrivers = drivers.filter((d) => d.timestamp && now - d.timestamp > STALE_MS)

  return (
    <section className="space-y-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex justify-between items-center bg-white border border-[#D3D1C7] rounded-xl px-4 py-3 text-left hover:border-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {drivers.length > 0 && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${drivers.length > 0 ? 'bg-accent' : 'bg-gray-300'}`} />
          </span>
          <span className="font-semibold text-sm">
            Mapa en vivo
            {drivers.length > 0 && (
              <span className="ml-2 text-accent">{drivers.length} activo{drivers.length !== 1 ? 's' : ''}</span>
            )}
          </span>
        </div>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="space-y-3">
          {staleDrivers.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
              ⚠ {staleDrivers.map((d) => d.nombreChofer || d.email).join(', ')} sin movimiento &gt; 20 min
            </div>
          )}

          <div className="rounded-xl overflow-hidden border border-[#D3D1C7]" style={{ height: '320px' }}>
            <MapaBase
              modo="oscuro"
              opciones={{ gestureHandling: 'cooperative' }}
              onLoad={(m) => { mapRef.current = m }}
            >
              {() => (<>
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
            
              </>)}
            </MapaBase>
          </div>

          {drivers.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-2">No hay choferes activos en este momento</p>
          ) : (
            <div className="grid gap-2">
              {drivers.map((driver) => {
                const isStale = !!(driver.timestamp && now - driver.timestamp > STALE_MS)
                const pending = pendingByDriver[driver.email] ?? 0
                return (
                  <div
                    key={driver.email}
                    className={`bg-white border rounded-xl px-4 py-3 flex justify-between items-center gap-3 ${
                      isStale ? 'border-amber-300' : 'border-[#D3D1C7]'
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
                      <p className="text-gray-500 text-xs mt-0.5">pendientes</p>
                      {isStale && <p className="text-amber-600 text-xs mt-1">⚠ &gt;20 min</p>}
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
