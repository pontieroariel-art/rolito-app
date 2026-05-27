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
        className="w-full flex justify-between items-center bg-surface border border-border rounded-xl px-4 py-3 text-left hover:border-accent/50 transition-colors"
      >
        <span className="font-semibold text-sm">Resumen de carga del día</span>
        <span className="text-muted text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="space-y-3">
          {sinAsignar.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 text-sm text-yellow-400">
              ⚠ {sinAsignar.length} pedido{sinAsignar.length !== 1 ? 's' : ''} sin chofer asignado
            </div>
          )}

          {drivers.length === 0 ? (
            <p className="text-muted text-sm text-center py-2">No hay pedidos activos asignados</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {drivers.map(([email, { nombre, totals, paradas }]) => {
                const items        = Object.entries(totals).sort((a, b) => b[1] - a[1])
                const totalUnidades = items.reduce((acc, [, q]) => acc + q, 0)
                return (
                  <div key={email} className="bg-surface border border-border rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-sm">{nombre}</p>
                        <p className="text-xs text-muted mt-0.5">{paradas} parada{paradas !== 1 ? 's' : ''}</p>
                      </div>
                      <span className="text-accent font-bold text-lg leading-none">{totalUnidades}</span>
                    </div>
                    <div className="space-y-1.5 pt-2 border-t border-border/60">
                      {items.map(([nombre, qty]) => (
                        <div key={nombre} className="flex justify-between items-center text-sm">
                          <span className="text-muted truncate flex-1 mr-2">{nombre}</span>
                          <span className="font-bold text-white shrink-0">{qty} u</span>
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
