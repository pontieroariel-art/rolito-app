import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import Badge from '../../components/ui/Badge'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useClientOrders } from '../../hooks/useOrders'
import { ALL_STATUSES, STATUS_LABELS } from '../../utils/constants'
import { formatDate, formatShortDate, summarizeProducts } from '../../utils/helpers'
import { createOrder } from '../../services/orderService'
import { useAuth } from '../../context/AuthContext'
import { Order, OrderStatus } from '../../types'

export default function OrderHistory() {
  const { orders, loading } = useClientOrders()
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all')

  const filtered =
    filter === 'all' ? orders : orders.filter((o) => o.status === filter)

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-4 pb-10">
        <div>
          <h1 className="text-2xl font-bold">Historial de pedidos</h1>
          <p className="text-muted text-sm mt-1">
            {orders.length} pedido{orders.length !== 1 ? 's' : ''} en total
          </p>
        </div>

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
