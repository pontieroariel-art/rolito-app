import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { getOrdersInRange } from '../../services/orderService'
import { Order, OrderProduct } from '../../types'
import { PRODUCTS } from '../../utils/constants'

// ── helpers ───────────────────────────────────────────────────────────────────

function monthBounds(year: number, month: number) {
  const start = new Date(year, month, 1, 0, 0, 0, 0)
  const end   = new Date(year, month + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

function prevMonthBounds(year: number, month: number) {
  const d = new Date(year, month - 1, 1)
  return monthBounds(d.getFullYear(), d.getMonth())
}

function totalUnits(products: OrderProduct[]): number {
  return products.reduce((s, p) => s + (p.quantity ?? 0), 0)
}

function productName(id: string): string {
  return PRODUCTS.find((p) => p.id === id)?.name ?? id
}

function deliveredOrders(orders: Order[]): Order[] {
  return orders.filter((o) => o.status === 'entregado')
}

function pct(current: number, prev: number): number | null {
  if (prev === 0) return null
  return Math.round(((current - prev) / prev) * 100)
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, prev, unit = '',
}: { label: string; value: number; prev: number; unit?: string }) {
  const delta = pct(value, prev)
  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-1">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold">{value.toLocaleString('es-AR')}{unit}</p>
      {delta !== null && (
        <p className={`text-xs font-medium ${delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs mes anterior
        </p>
      )}
      {delta === null && <p className="text-xs text-muted">Sin datos del mes anterior</p>}
    </div>
  )
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function ReporteVentasPage() {
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  const { start, end }       = monthBounds(year, month)
  const { start: ps, end: pe } = prevMonthBounds(year, month)

  const { data: current = [], isLoading: loadingCurrent } = useQuery({
    queryKey: ['ventas', year, month],
    queryFn:  () => getOrdersInRange(start, end),
  })

  const { data: previous = [], isLoading: loadingPrev } = useQuery({
    queryKey: ['ventas', year, month - 1],
    queryFn:  () => getOrdersInRange(ps, pe),
  })

  const isLoading = loadingCurrent || loadingPrev

  // Only count delivered orders for revenue metrics
  const delivered     = useMemo(() => deliveredOrders(current), [current])
  const deliveredPrev = useMemo(() => deliveredOrders(previous), [previous])

  const totalDeliveries = delivered.length
  const totalDelivPrev  = deliveredPrev.length

  const totalKg     = useMemo(() => delivered.reduce((s, o) => s + totalUnits(o.products), 0), [delivered])
  const totalKgPrev = useMemo(() => deliveredPrev.reduce((s, o) => s + totalUnits(o.products), 0), [deliveredPrev])

  // Daily trend — group delivered by day of month
  const dailyTrend = useMemo(() => {
    const map: Record<number, number> = {}
    for (const o of delivered) {
      const d = o.date?.toDate ? o.date.toDate() : new Date((o.date as any)?.seconds * 1000)
      const day = d.getDate()
      map[day] = (map[day] ?? 0) + totalUnits(o.products)
    }
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    return Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      kg: map[i + 1] ?? 0,
    }))
  }, [delivered, year, month])

  // Units by product
  const byProduct = useMemo(() => {
    const map: Record<string, number> = {}
    for (const o of delivered) {
      for (const p of o.products) {
        const key = p.productoId ?? p.name
        map[key] = (map[key] ?? 0) + (p.quantity ?? 0)
      }
    }
    return Object.entries(map)
      .map(([id, qty]) => ({ id, name: productName(id) || id, qty }))
      .sort((a, b) => b.qty - a.qty)
  }, [delivered])

  // Top clients by volume
  const topClients = useMemo(() => {
    const map: Record<string, { name: string; qty: number; orders: number }> = {}
    for (const o of delivered) {
      const key = o.clientId
      if (!map[key]) map[key] = { name: o.clientName, qty: 0, orders: 0 }
      map[key].qty    += totalUnits(o.products)
      map[key].orders += 1
    }
    return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 10)
  }, [delivered])

  // Month navigation
  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    const next = new Date(year, month + 1, 1)
    if (next > now) return
    if (month === 11) { setYear((y) => y + 1); setMonth(0) }
    else setMonth((m) => m + 1)
  }

  const monthLabel = new Date(year, month, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  // Excel export
  function exportExcel() {
    const wb = XLSX.utils.book_new()

    // Sheet 1: resumen diario
    const dailyRows = dailyTrend.map((d) => ({ Día: d.day, 'Unidades entregadas': d.kg }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows), 'Tendencia diaria')

    // Sheet 2: por producto
    const prodRows = byProduct.map((p) => ({ Producto: p.name, 'Unidades': p.qty }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prodRows), 'Por producto')

    // Sheet 3: top clientes
    const clientRows = topClients.map((c) => ({ Cliente: c.name, Pedidos: c.orders, Unidades: c.qty }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clientRows), 'Top clientes')

    // Sheet 4: detalle pedidos
    const detailRows = delivered.map((o) => ({
      Fecha:    (o.date?.toDate ? o.date.toDate() : new Date((o.date as any)?.seconds * 1000)).toLocaleDateString('es-AR'),
      Cliente:  o.clientName,
      Dirección: o.clientAddress,
      Chofer:   o.driverId ?? '',
      Unidades: totalUnits(o.products),
      Parcial:  o.entregaParcial ? 'Sí' : 'No',
      Nota:     o.notaEntrega ?? '',
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Detalle pedidos')

    XLSX.writeFile(wb, `ventas_${year}-${String(month + 1).padStart(2, '0')}.xlsx`)
  }

  return (
    <>
      <Navbar />
      <main className="max-w-4xl mx-auto p-4 space-y-6 pb-10">

        {/* Header + nav */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Reporte de ventas</h1>
            <p className="text-muted text-sm mt-0.5 capitalize">{monthLabel}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={prevMonth}
              className="p-2 rounded-lg hover:bg-surface border border-transparent hover:border-border transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={nextMonth}
              disabled={isCurrentMonth}
              className="p-2 rounded-lg hover:bg-surface border border-transparent hover:border-border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={18} />
            </button>
            <button
              onClick={exportExcel}
              disabled={isLoading || delivered.length === 0}
              className="ml-2 flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2 text-sm hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={14} />
              Exportar
            </button>
          </div>
        </div>

        {isLoading ? <LoadingSpinner /> : (
          <>
            {/* KPIs */}
            <section className="grid grid-cols-2 gap-3">
              <KpiCard label="Entregas" value={totalDeliveries} prev={totalDelivPrev} />
              <KpiCard label="Unidades entregadas" value={totalKg} prev={totalKgPrev} />
            </section>

            {delivered.length === 0 ? (
              <div className="bg-surface border border-border rounded-xl p-8 text-center text-muted text-sm">
                No hay entregas registradas en {monthLabel}
              </div>
            ) : (
              <>
                {/* Daily trend chart */}
                <section className="bg-surface border border-border rounded-xl p-4 space-y-3">
                  <h2 className="text-xs font-semibold text-muted uppercase tracking-wide">
                    Tendencia diaria — unidades entregadas
                  </h2>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={dailyTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" vertical={false} />
                      <XAxis
                        dataKey="day"
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        interval={dailyTrend.length > 20 ? 4 : 1}
                      />
                      <YAxis
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{ background: '#0d1f35', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                        labelFormatter={(v) => `Día ${v}`}
                        formatter={(v: any) => [`${v} u.`, 'Entregadas']}
                        cursor={{ fill: '#1e3a5f55' }}
                      />
                      <Bar dataKey="kg" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </section>

                {/* By product */}
                {byProduct.length > 0 && (
                  <section className="bg-surface border border-border rounded-xl p-4 space-y-3">
                    <h2 className="text-xs font-semibold text-muted uppercase tracking-wide">
                      Unidades por producto
                    </h2>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left text-muted text-xs py-2 font-medium">Producto</th>
                          <th className="text-right text-muted text-xs py-2 font-medium">Unidades</th>
                          <th className="text-right text-muted text-xs py-2 font-medium">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byProduct.map((p) => (
                          <tr key={p.id} className="border-b border-border/40 last:border-0">
                            <td className="py-2">{p.name}</td>
                            <td className="py-2 text-right font-medium">{p.qty.toLocaleString('es-AR')}</td>
                            <td className="py-2 text-right text-muted">
                              {totalKg > 0 ? Math.round((p.qty / totalKg) * 100) : 0}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}

                {/* Top clients */}
                {topClients.length > 0 && (
                  <section className="bg-surface border border-border rounded-xl p-4 space-y-3">
                    <h2 className="text-xs font-semibold text-muted uppercase tracking-wide">
                      Clientes — mayor volumen
                    </h2>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left text-muted text-xs py-2 font-medium">#</th>
                          <th className="text-left text-muted text-xs py-2 font-medium">Cliente</th>
                          <th className="text-right text-muted text-xs py-2 font-medium">Pedidos</th>
                          <th className="text-right text-muted text-xs py-2 font-medium">Unidades</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topClients.map((c, i) => (
                          <tr key={i} className="border-b border-border/40 last:border-0">
                            <td className="py-2 text-muted">{i + 1}</td>
                            <td className="py-2 font-medium">{c.name}</td>
                            <td className="py-2 text-right text-muted">{c.orders}</td>
                            <td className="py-2 text-right font-medium">{c.qty.toLocaleString('es-AR')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </main>
    </>
  )
}
