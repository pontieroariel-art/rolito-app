import { useState, useEffect, useRef, useMemo } from 'react'
import { Marker, InfoWindow } from '@react-google-maps/api'
import { MapPin } from 'lucide-react'
import MapaBase from '@/components/common/map/MapaBase'
import { pinCircular, pinGota } from '@/components/common/map/pines'
import { subscribeAllActiveDrivers, ActiveDriver } from '@/services/locationService'
import { Order, UserProfile } from '@/types'
import { normalizeAddress } from '@/utils/helpers'

// Mapa de seguimiento del Tablero comercial. Vivía adentro de
// ComercialDashboard.tsx; está aparte para que el home lo cargue con
// React.lazy y el chunk `maps` (@react-google-maps/api) no baje con la
// pantalla sino recién al montar esta sección (auditoría de bundle 2026-09-14).

// Iniciales del chofer para el pin del mapa (antes era el pin azul genérico de Google).
const inicialesChofer = (nombre: string) => nombre.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()

export default function TrackingMap({ orders, clientes }: { orders: Order[]; clientes: UserProfile[] }) {
  const [open, setOpen]               = useState(false)
  const [drivers, setDrivers]         = useState<ActiveDriver[]>([])
  const [selected, setSelected]       = useState<string | null>(null)
  const mapRef                        = useRef<google.maps.Map | null>(null)

  useEffect(() => {
    if (!open) return
    return subscribeAllActiveDrivers(setDrivers)
  }, [open])

  const activeOrders = orders.filter((o) => !['entregado', 'cancelado'].includes(o.status))

  // Antes se dibujaba cada pedido activo en BA_DEFAULT (coordenada fija) sin
  // importar su dirección real — todos los pines quedaban superpuestos en el
  // mismo punto. Se resuelve la posición real matcheando contra las
  // direcciones ya geocodificadas del cliente (lat/lng cargados desde el
  // mapa de clientes); si no hay match geocodificado, no se dibuja el pin en
  // vez de mostrar una ubicación falsa.
  const clientCoordsByKey = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number }>()
    for (const c of clientes) {
      for (const a of c.addresses ?? []) {
        if (a.lat != null && a.lng != null) {
          map.set(`${c.uid}|${normalizeAddress(a.address)}`, { lat: a.lat, lng: a.lng })
        }
      }
      if (c.lat != null && c.lng != null) map.set(`${c.uid}|${normalizeAddress(c.address || '')}`, { lat: c.lat, lng: c.lng })
    }
    return map
  }, [clientes])

  const ordersWithCoords = activeOrders
    .map((o) => ({ order: o, coords: clientCoordsByKey.get(`${o.clientId}|${normalizeAddress(o.clientAddress)}`) }))
    .filter((x): x is { order: Order; coords: { lat: number; lng: number } } => !!x.coords)

  return (
    <section className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full bg-white border border-[#D3D1C7] rounded-xl px-4 py-3 flex items-center justify-between hover:border-accent transition-colors text-sm"
      >
        <div className="flex items-center gap-2 font-medium">
          <MapPin size={15} className="text-accent" />
          Mapa de seguimiento
          {drivers.length > 0 && (
            <span className="text-xs text-accent">· {drivers.length} chofer{drivers.length !== 1 ? 'es' : ''} activo{drivers.length !== 1 ? 's' : ''}</span>
          )}
          {activeOrders.length > 0 && (
            <span className="text-xs text-secundario">· {activeOrders.length} pedido{activeOrders.length !== 1 ? 's' : ''} en curso</span>
          )}
        </div>
        <span className="text-secundario text-xs">{open ? '▲ Cerrar' : '▼ Ver mapa'}</span>
      </button>

      {open && (
        <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden" style={{ height: 380 }}>
          <MapaBase
            modo="oscuro"
            onLoad={(m) => { mapRef.current = m }}
          >
            {() => (<>
              {/* Choferes activos */}
              {drivers.map((d) => (
                <Marker
                  key={d.email}
                  position={{ lat: d.lat, lng: d.lng }}
                  icon={pinCircular('#00C2FF', inicialesChofer(d.nombreChofer || d.email), { tamano: 36, grosorBorde: 2 })}
                  onClick={() => setSelected((s) => s === d.email ? null : d.email)}
                >
                  {selected === d.email && (
                    <InfoWindow onCloseClick={() => setSelected(null)}>
                      <div style={{ color: '#111', fontSize: 13 }}>
                        <p style={{ fontWeight: 700, margin: '0 0 2px' }}>{d.nombreChofer || d.email}</p>
                        {d.telefonoChofer && <p style={{ margin: 0 }}>📞 {d.telefonoChofer}</p>}
                      </div>
                    </InfoWindow>
                  )}
                </Marker>
              ))}

              {/* Pedidos activos con coordenadas reales (geocodificadas) */}
              {ordersWithCoords.map(({ order, coords }) => (
                <Marker
                  key={order.id}
                  position={coords}
                  icon={pinGota('#EF4444', '', { ancho: 26 })}
                />
              ))}
            </>)}
          </MapaBase>
        </div>
      )}
    </section>
  )
}
