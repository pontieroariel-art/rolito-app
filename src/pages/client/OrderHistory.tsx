import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useBranch } from '../../context/BranchContext'
import { useAuth } from '../../context/AuthContext'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import Navbar from '../../components/layout/Navbar'
import Badge from '../../components/ui/Badge'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useClientOrders } from '../../hooks/useOrders'
import { ALL_STATUSES, STATUS_LABELS } from '../../utils/constants'
import { formatDate, formatShortDate, summarizeProducts } from '../../utils/helpers'
import { createOrder } from '../../services/orderService'
import { Order, OrderStatus } from '../../types'

// ── helpers de estadísticas ───────────────────────────────────────────────────

function orderToDate(o: Order): Date {
  return o.date?.toDate ? o.date.toDate() : new Date((o.date as any)?.seconds * 1000)
}

function useConsumoStats(orders: Order[]) {
  return useMemo(() => {
    const delivered = orders.filter((o) => o.status === 'entregado')
    const now       = new Date()

    // Últimos 6 meses
    const meses: { label: string; mes: number; anio: number; unidades: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      meses.push({
        label:    d.toLocaleDateString('es-AR', { month: 'short' }),
        mes:      d.getMonth(),
        anio:     d.getFullYear(),
        unidades: 0,
      })
    }

    // Producto más pedido
    const prodCount: Record<string, { nombre: string; qty: number }> = {}

    for (const o of delivered) {
      const d = orderToDate(o)
      const slot = meses.find((m) => m.mes === d.getMonth() && m.anio === d.getFullYear())
      const units = o.products.reduce((s, p) => s + (p.quantity ?? 0), 0)
      if (slot) slot.unidades += units
      o.products.forEach((p) => {
        const id = p.productoId ?? p.name
        if (!prodCount[id]) prodCount[id] = { nombre: p.name, qty: 0 }
        prodCount[id].qty += p.quantity ?? 0
      })
    }

    const thisMonth = meses[5].unidades
    const lastMonth = meses[4].unidades
    const delta     = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null

    const topProd = Object.values(prodCount).sort((a, b) => b.qty - a.qty)[0] ?? null

    return { meses, thisMonth, lastMonth, delta, topProd }
  }, [orders])
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function OrderHistory() {
  const { user }               = useAuth()
  const { orders, loading }    = useClientOrders()
  const { selectedAddress }    = useBranch()
  const [filter, setFilter]    = useState<OrderStatus | 'all'>('all')

  const multiSucursal = (user?.addresses?.length ?? 0) > 1

  const branchOrders = useMemo(() => {
    if (!multiSucursal || !selectedAddress) return orders
    return orders.filter((o) => o.clientAddress === selectedAddress.address)
  }, [orders, multiSucursal, selectedAddress])

  const stats = useConsumoStats(branchOrders)

  const filtered =
    filter === 'all' ? branchOrders : branchOrders.filter((o) => o.status === filter)

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-4 pb-10">
        <div>
          <h1 className="text-2xl font-bold">Historial de pedidos</h1>
          {multiSucursal && selectedAddress ? (
            <div className="flex items-center gap-2 mt-1">
              <p className="text-accent text-sm font-medium">📍 {selectedAddress.nombre}</p>
              <Link to="/sucursal" className="text-xs text-muted hover:text-white transition-colors">
                Cambiar →
              </Link>
            </div>
          ) : (
            <p className="text-muted text-sm mt-1">
              {branchOrders.length} pedido{branchOrders.length !== 1 ? 's' : ''} en total
            </p>
          )}
        </div>

        {/* ── Estadísticas de consumo ── */}
        {stats.thisMonth > 0 || stats.lastMonth > 0 ? (
          <div className="bg-surface border border-border rounded-xl p-4 space-y-4">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">
              Mi consumo — últimos 6 meses
            </p>

            {/* KPIs */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-0.5">
                <p className="text-xs text-muted">Este mes</p>
                <p className="text-2xl font-bold text-accent">{stats.thisMonth}</p>
                <p className="text-xs text-muted">unidades</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted">Mes anterior</p>
                <p className="text-2xl font-bold">{stats.lastMonth}</p>
                {stats.delta !== null && (
                  <p className={`text-xs font-medium ${stats.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {stats.delta >= 0 ? '▲' : '▼'} {Math.abs(stats.delta)}%
                  </p>
                )}
              </div>
              {stats.topProd && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted">Más pedido</p>
                  <p className="text-sm font-semibold leading-tight">{stats.topProd.nombre}</p>
                  <p className="text-xs text-muted">{stats.topProd.qty} u.</p>
                </div>
              )}
            </div>

            {/* Gráfico */}
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={stats.meses} margin={{ top: 4, right: 0, left: -30, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ background: '#0d1f35', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => [`${v} u.`, 'Unidades']}
                  cursor={{ fill: '#1e3a5f55' }}
                />
                <Bar dataKey="unidades" radius={[4, 4, 0, 0]} maxBarSize={32}>
                  {stats.meses.map((m, i) => (
                    <Cell
                      key={i}
                      fill={i === 5 ? '#00C2FF' : '#1e3a5f'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}

        <div className="flex gap-2 flex-wrap">
          {(['all', ...ALL_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filter === s
                  ? 'bg-accent text-bg border-accent'
                  : 'border-border text-muted hover:border-accent hover:text-white'
              }`}
            >
              {s === 'all' ? 'Todos' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-8 text-center">
              <p className="text-muted text-sm">
                {filter === 'all'
                  ? 'No tenés pedidos todavía'
                  : `No hay pedidos con estado "${STATUS_LABELS[filter as OrderStatus]}"`}
              </p>
            </div>
          ) : (
            filtered.map((o) => <OrderCard key={o.id} order={o} />)
          )}
        </div>
      </main>
    </>
  )
}

function OrderCard({ order }: { order: Order }) {
  const { user }              = useAuth()
  const navigate              = useNavigate()
  const [copying, setCopying] = useState(false)

  const handleRepeat = async () => {
    if (!user) return
    setCopying(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      await createOrder({
        user,
        products: order.products,
        date:     today,
        notes:    order.notes,
      })
      navigate('/dashboard')
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <p className="font-medium text-sm">{summarizeProducts(order.products)}</p>
          <p className="text-muted text-xs mt-1">Entrega: {formatDate(order.date)}</p>
          <p className="text-muted text-xs">Pedido el: {formatShortDate(order.createdAt)}</p>
        </div>
        <Badge status={order.status} />
      </div>

      {order.reprogramado && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 text-xs space-y-0.5">
          <p className="text-yellow-400 font-medium">Pedido reprogramado</p>
          {order.fechaOriginal && (
            <p className="text-muted">Fecha original: {formatShortDate(order.fechaOriginal)}</p>
          )}
          {order.motivoReprogramacion && (
            <p className="text-muted">Motivo: {order.motivoReprogramacion}</p>
          )}
        </div>
      )}

      {order.notes && (
        <p className="text-xs text-muted italic border-t border-border pt-2">"{order.notes}"</p>
      )}

      {user?.address && (
        <button
          onClick={handleRepeat}
          disabled={copying}
          className="text-xs text-accent hover:underline disabled:opacity-50"
        >
          {copying ? 'Copiando...' : '↻ Repetir este pedido'}
        </button>
      )}
    </div>
  )
}
