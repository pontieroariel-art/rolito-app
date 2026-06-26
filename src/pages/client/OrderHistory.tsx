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

function orderToDate(o: Order): Date {
  return o.date?.toDate ? o.date.toDate() : new Date((o.date as any)?.seconds * 1000)
}

function useConsumoStats(orders: Order[]) {
  return useMemo(() => {
    const delivered = orders.filter((o) => o.status === 'entregado')
    const now       = new Date()

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

  if (loading) return <><Navbar /><LoadingSpinner fullScreen className="bg-white" /></>

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-4 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Historial de pedidos</h1>
          {multiSucursal && selectedAddress ? (
            <div className="flex items-center gap-2 mt-1">
              <p className="text-accent text-sm font-medium">📍 {selectedAddress.nombre}</p>
              <Link to="/sucursal" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
                Cambiar →
              </Link>
            </div>
          ) : (
            <p className="text-gray-500 text-sm mt-1">
              {branchOrders.length} pedido{branchOrders.length !== 1 ? 's' : ''} en total
            </p>
          )}
        </div>

        {stats.thisMonth > 0 || stats.lastMonth > 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Mi consumo — últimos 6 meses
            </p>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Este mes</p>
                <p className="text-2xl font-bold text-accent">{stats.thisMonth}</p>
                <p className="text-xs text-gray-500">unidades</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Mes anterior</p>
                <p className="text-2xl font-bold text-gray-900">{stats.lastMonth}</p>
                {stats.delta !== null && (
                  <p className={`text-xs font-medium ${stats.delta >= 0 ? 'text-accent' : 'text-red-500'}`}>
                    {stats.delta >= 0 ? '▲' : '▼'} {Math.abs(stats.delta)}%
                  </p>
                )}
              </div>
              {stats.topProd && (
                <div className="space-y-0.5">
                  <p className="text-xs text-gray-500">Más pedido</p>
                  <p className="text-sm font-semibold text-gray-900 leading-tight">{stats.topProd.nombre}</p>
                  <p className="text-xs text-gray-500">{stats.topProd.qty} u.</p>
                </div>
              )}
            </div>

            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={stats.meses} margin={{ top: 4, right: 30, left: -30, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => [`${v} u.`, 'Unidades']}
                  cursor={{ fill: '#f3f4f6' }}
                />
                <Bar dataKey="unidades" radius={[4, 4, 0, 0]} maxBarSize={32}>
                  {stats.meses.map((m, i) => (
                    <Cell
                      key={i}
                      fill={i === 5 ? '#1D9E75' : '#D1FAE5'}
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
                  ? 'bg-accent text-white border-accent'
                  : 'border-gray-200 text-gray-500 hover:border-accent/50 hover:text-gray-900'
              }`}
            >
              {s === 'all' ? 'Todos' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
              <p className="text-gray-400 text-sm">
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
    </div>
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
    <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <p className="font-medium text-sm text-gray-900">{summarizeProducts(order.products)}</p>
          <p className="text-gray-500 text-xs mt-1">Entrega: {formatDate(order.date)}</p>
          <p className="text-gray-400 text-xs">Pedido el: {formatShortDate(order.createdAt)}</p>
        </div>
        <Badge status={order.status} variant="light" />
      </div>

      {order.reprogramado && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs space-y-0.5">
          <p className="text-amber-700 font-medium">Pedido reprogramado</p>
          {order.fechaOriginal && (
            <p className="text-gray-500">Fecha original: {formatShortDate(order.fechaOriginal)}</p>
          )}
          {order.motivoReprogramacion && (
            <p className="text-gray-500">Motivo: {order.motivoReprogramacion}</p>
          )}
        </div>
      )}

      {order.notes && (
        <p className="text-xs text-gray-500 italic border-t border-gray-100 pt-2">"{order.notes}"</p>
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
