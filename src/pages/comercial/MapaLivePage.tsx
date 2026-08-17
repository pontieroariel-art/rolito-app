import { useEffect, useMemo, useState } from 'react'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { LiveMap, driverColor, gpsAge } from '../../components/admin/LiveMap'
import { useAllOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { subscribeAllActiveDrivers, ActiveDriver } from '../../services/locationService'
import { summarizeProducts, toDateStr, todayString } from '../../utils/helpers'
import { Order, UserProfile } from '../../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function orderDateStr(o: Order): string {
  if (!o.date?.toDate) return ''
  return toDateStr(o.date.toDate())
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

// ── Página principal ──────────────────────────────────────────────────────────

export default function MapaLivePage() {
  const { orders,   loading: loadO } = useAllOrders()
  const { choferes, loading: loadC } = useChoferes()
  const [activeDrivers, setActiveDrivers]   = useState<ActiveDriver[]>([])
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null)

  useEffect(() => subscribeAllActiveDrivers(setActiveDrivers), [])

  const today = useMemo(() => todayString(), [])

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

  if (loadO || loadC) return <LoadingSpinner fullScreen />

  return (
    <>
      <div className="flex flex-col md:flex-row h-[calc(100dvh-48px)] md:h-dvh">

        {/* Sidebar */}
        <aside className="w-full md:w-64 md:shrink-0 bg-white border-b md:border-b-0 md:border-r border-[#D3D1C7] flex flex-col overflow-hidden max-h-[45%] md:max-h-none">

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
