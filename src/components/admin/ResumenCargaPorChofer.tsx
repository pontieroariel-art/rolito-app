import { useState, useMemo } from 'react'
import { Order, UserProfile } from '../../types'

interface ResumenCargaPorChoferProps {
  orders:   Order[]
  choferes: UserProfile[]
}

export function ResumenCargaPorChofer({ orders, choferes }: ResumenCargaPorChoferProps) {
  const [open, setOpen] = useState(true)

  const active = useMemo(
    () => orders.filter((o) => !['entregado', 'cancelado'].includes(o.status) && o.driverId),
    [orders],
  )

  const sinAsignar = useMemo(
    () => orders.filter((o) => !['entregado', 'cancelado'].includes(o.status) && !o.driverId),
    [orders],
  )

  const drivers = useMemo(() => {
    const driverMap = new Map(choferes.map((c) => [c.email, c]))
    const byDriver: Record<string, { nombre: string; totals: Record<string, number>; paradas: number }> = {}
    active.forEach((o) => {
      const id = o.driverId!
      if (!byDriver[id]) {
        const chofer = driverMap.get(id)
        byDriver[id] = { nombre: chofer?.nombreContacto || chofer?.nombre || id, totals: {}, paradas: 0 }
      }
      byDriver[id].paradas++
      o.products.forEach((p) => {
        byDriver[id].totals[p.name] = (byDriver[id].totals[p.name] ?? 0) + p.quantity
      })
    })
    return Object.entries(byDriver)
  }, [active, choferes])

  if (drivers.length === 0 && sinAsignar.length === 0) return null

  return (
    <section className="space-y-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex justify-between items-center bg-white border border-[#D3D1C7] rounded-xl px-4 py-3 text-left hover:border-accent/50 transition-colors"
      >
        <span className="font-medium text-sm text-gray-900">Resumen de carga del día</span>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="space-y-3">
          {sinAsignar.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
              ⚠ {sinAsignar.length} pedido{sinAsignar.length !== 1 ? 's' : ''} sin chofer asignado
            </div>
          )}

          {drivers.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-2">No hay pedidos activos asignados</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {drivers.map(([email, { nombre, totals, paradas }]) => {
                const items        = Object.entries(totals).sort((a, b) => b[1] - a[1])
                const totalUnidades = items.reduce((acc, [, q]) => acc + q, 0)
                return (
                  <div key={email} className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-sm text-gray-900">{nombre}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{paradas} parada{paradas !== 1 ? 's' : ''}</p>
                      </div>
                      <span className="text-accent font-bold text-lg leading-none">{totalUnidades}</span>
                    </div>
                    <div className="space-y-1.5 pt-2 border-t border-gray-100">
                      {items.map(([nombre, qty]) => (
                        <div key={nombre} className="flex justify-between items-center text-sm">
                          <span className="text-gray-500 truncate flex-1 mr-2">{nombre}</span>
                          <span className="font-medium text-gray-900 shrink-0">{qty} u</span>
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
