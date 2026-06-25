import { useMemo, useState } from 'react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAllOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { formatShortDate, tsToDate } from '../../utils/helpers'
import { Order } from '../../types'

type Periodo = '7d' | '30d' | '90d'

function periodLabel(p: Periodo): string {
  if (p === '7d')  return 'Últimos 7 días'
  if (p === '30d') return 'Últimos 30 días'
  return 'Últimos 90 días'
}

function periodDays(p: Periodo): number {
  if (p === '7d')  return 7
  if (p === '30d') return 30
  return 90
}

export default function ReporteIncidenciasPage() {
  const { orders, loading } = useAllOrders()
  const { choferes }        = useChoferes()
  const [periodo, setPeriodo] = useState<Periodo>('30d')

  const incidencias = useMemo(() => {
    const cutoff = new Date(Date.now() - periodDays(periodo) * 24 * 60 * 60 * 1000)
    return orders.filter((o) => {
      if (!o.reprogramado && !o.reasignado) return false
      const d = tsToDate(o.updatedAt)
      return d >= cutoff
    })
  }, [orders, periodo])

  const stats = useMemo(() => {
    const totalOrders = orders.filter((o) => {
      const d = tsToDate(o.createdAt)
      return d >= new Date(Date.now() - periodDays(periodo) * 24 * 60 * 60 * 1000)
    }).length

    // Por motivo
    const porMotivo: Record<string, number> = {}
    for (const o of incidencias) {
      const m = o.motivoReprogramacion || o.motivoReasignacion || 'Sin motivo'
      porMotivo[m] = (porMotivo[m] ?? 0) + 1
    }

    // Por chofer original
    const porChofer: Record<string, number> = {}
    for (const o of incidencias) {
      const email = o.choferOriginal || ''
      if (!email) continue
      porChofer[email] = (porChofer[email] ?? 0) + 1
    }

    const topMotivo = Object.entries(porMotivo).sort((a, b) => b[1] - a[1])[0]
    const topChofer = Object.entries(porChofer).sort((a, b) => b[1] - a[1])[0]

    const choferNombre = (email: string) => {
      const c = choferes.find((ch) => ch.email === email)
      return c?.nombreContacto || c?.nombre || email.split('@')[0]
    }

    return {
      total: incidencias.length,
      totalOrders,
      pct: totalOrders > 0 ? Math.round((incidencias.length / totalOrders) * 100) : 0,
      reprogramadas: incidencias.filter((o) => o.reprogramado).length,
      reasignadas:   incidencias.filter((o) => o.reasignado && !o.reprogramado).length,
      porMotivo,
      topMotivo,
      topChofer: topChofer ? { email: topChofer[0], count: topChofer[1], nombre: choferNombre(topChofer[0]) } : null,
    }
  }, [incidencias, orders, periodo, choferes])

  const choferNombre = (email: string | undefined) => {
    if (!email) return '—'
    const c = choferes.find((ch) => ch.email === email)
    return c?.nombreContacto || c?.nombre || email.split('@')[0]
  }

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">

        {/* Header */}
        <div className="flex flex-wrap justify-between items-end gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reporte de incidencias</h1>
            <p className="text-gray-500 text-sm mt-1">Pedidos reprogramados y reasignados</p>
          </div>
          <div className="flex rounded-lg border border-[#D3D1C7] overflow-hidden text-xs">
            {(['7d', '30d', '90d'] as Periodo[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`px-3 py-1.5 transition-colors ${periodo === p ? 'bg-accent text-white font-semibold' : 'text-gray-500 hover:text-gray-900'}`}
              >
                {p === '7d' ? '7 días' : p === '30d' ? '30 días' : '90 días'}
              </button>
            ))}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
            <p className="text-xs text-gray-500">Total incidencias</p>
            <p className="text-3xl font-bold text-amber-600">{stats.total}</p>
            <p className="text-xs text-gray-500">{periodLabel(periodo)}</p>
          </div>
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
            <p className="text-xs text-gray-500">% del total</p>
            <p className="text-3xl font-bold text-gray-900">{stats.pct}%</p>
            <p className="text-xs text-gray-500">de {stats.totalOrders} pedidos</p>
          </div>
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
            <p className="text-xs text-gray-500">Reprogramadas</p>
            <p className="text-3xl font-bold text-accent">{stats.reprogramadas}</p>
            <p className="text-xs text-gray-500">cambiaron de fecha</p>
          </div>
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
            <p className="text-xs text-gray-500">Reasignadas</p>
            <p className="text-3xl font-bold text-purple-600">{stats.reasignadas}</p>
            <p className="text-xs text-gray-500">cambiaron de chofer</p>
          </div>
        </div>

        {/* Stats secundarios */}
        {stats.total > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            {/* Por motivo */}
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-900">Por motivo</p>
              {Object.entries(stats.porMotivo)
                .sort((a, b) => b[1] - a[1])
                .map(([motivo, count]) => {
                  const pct = Math.round((count / stats.total) * 100)
                  return (
                    <div key={motivo} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500 truncate">{motivo}</span>
                        <span className="font-medium text-gray-900 shrink-0 ml-2">{count} ({pct}%)</span>
                      </div>
                      <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
            </div>

            {/* Insights */}
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-900">Highlights</p>
              {stats.topMotivo && (
                <div className="flex items-start gap-3">
                  <span className="text-xl shrink-0">⚠</span>
                  <div>
                    <p className="text-xs text-gray-500">Motivo más frecuente</p>
                    <p className="text-sm font-medium text-gray-900">{stats.topMotivo[0]}</p>
                    <p className="text-xs text-gray-500">{stats.topMotivo[1]} incidencia{stats.topMotivo[1] !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              )}
              {stats.topChofer && (
                <div className="flex items-start gap-3">
                  <span className="text-xl shrink-0">🚛</span>
                  <div>
                    <p className="text-xs text-gray-500">Chofer con más incidencias</p>
                    <p className="text-sm font-medium text-gray-900">{stats.topChofer.nombre}</p>
                    <p className="text-xs text-gray-500">{stats.topChofer.count} incidencia{stats.topChofer.count !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              )}
              {stats.pct > 10 && (
                <div className="flex items-start gap-3">
                  <span className="text-xl shrink-0">📊</span>
                  <div>
                    <p className="text-xs text-red-600 font-medium">Tasa alta de incidencias</p>
                    <p className="text-xs text-gray-500">Más del 10% de los pedidos tuvieron problemas</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Listado detallado */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Detalle — {incidencias.length} incidencia{incidencias.length !== 1 ? 's' : ''}
          </h2>

          {incidencias.length === 0 ? (
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-10 text-center">
              <p className="text-3xl mb-3">✅</p>
              <p className="text-gray-500 text-sm">Sin incidencias en este período</p>
            </div>
          ) : (
            <div className="space-y-2">
              {incidencias
                .sort((a, b) => tsToDate(b.updatedAt).getTime() - tsToDate(a.updatedAt).getTime())
                .map((o) => (
                  <IncidenciaRow key={o.id} order={o} choferNombre={choferNombre} />
                ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function IncidenciaRow({ order, choferNombre }: { order: Order; choferNombre: (email?: string) => string }) {
  const tipo   = order.reprogramado ? 'Reprogramado' : 'Reasignado'
  const motivo = order.motivoReprogramacion || order.motivoReasignacion || '—'
  const color  = order.reprogramado ? 'text-accent border-accent/20 bg-accent/5' : 'text-purple-600 border-purple-200 bg-purple-50'

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex flex-wrap gap-3 justify-between items-start">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm text-gray-900">{order.clientName}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${color}`}>{tipo}</span>
        </div>
        <p className="text-xs text-gray-500">{order.clientAddress}</p>
        <p className="text-xs text-gray-500">
          Chofer: <span className="text-gray-900">{choferNombre(order.choferOriginal)}</span>
          {order.reprogramado && order.fechaOriginal && (
            <> · Fecha original: <span className="text-gray-900">{formatShortDate(order.fechaOriginal)}</span></>
          )}
        </p>
        <p className="text-xs text-gray-500">
          Motivo: <span className="text-gray-900">{motivo}</span>
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-gray-500">{formatShortDate(order.updatedAt)}</p>
        {order.reprogramado && (
          <p className="text-xs text-accent mt-1">→ {formatShortDate(order.date)}</p>
        )}
      </div>
    </div>
  )
}
