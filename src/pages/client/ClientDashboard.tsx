import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import Badge from '../../components/ui/Badge'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useClientOrders } from '../../hooks/useOrders'
import { useAuth } from '../../context/AuthContext'
import { formatShortDate, summarizeProducts } from '../../utils/helpers'
import { Order } from '../../types'

export default function ClientDashboard() {
  const { user }            = useAuth()
  const { orders, loading } = useClientOrders()

  const active    = orders.filter((o) => !['entregado', 'cancelado'].includes(o.status))
  const delivered = orders.filter((o) => o.status === 'entregado')
  const recent    = orders.slice(0, 5)

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold">
            Hola, {user?.nombre?.split(' ')[0] ?? 'amigo'} 👋
          </h1>
          <p className="text-muted text-sm mt-1">Gestión de pedidos de hielo</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Pedidos activos"    value={active.length}    color="text-accent" />
          <StatCard label="Pedidos entregados" value={delivered.length} color="text-success" />
        </div>

        {!user?.address && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm">
            <p className="text-yellow-400 font-medium">⚠ Completá tu perfil</p>
            <p className="text-yellow-400/70 mt-1">
              Necesitás agregar tu dirección para hacer pedidos.{' '}
              <Link to="/perfil" className="underline hover:text-yellow-300">
                Ir a Mi perfil →
              </Link>
            </p>
          </div>
        )}

        <Link
          to="/nuevo-pedido"
          className="flex items-center justify-center gap-2 w-full bg-accent text-bg font-semibold py-3 rounded-xl hover:bg-accent/90 transition-colors text-sm"
        >
          + Hacer nuevo pedido
        </Link>

        <section>
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold">Pedidos recientes</h2>
            {orders.length > 5 && (
              <Link to="/historial" className="text-accent text-sm hover:underline">
                Ver todos
              </Link>
            )}
          </div>

          {recent.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-8 text-center">
              <p className="text-muted text-sm">Aún no tenés pedidos</p>
              <p className="text-muted/60 text-xs mt-1">
                Hacé tu primer pedido usando el botón de arriba
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recent.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <p className="text-muted text-sm">{label}</p>
      <p className={`text-4xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  )
}

function OrderRow({ order }: { order: Order }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex justify-between items-start gap-3">
      <div className="min-w-0">
        <p className="font-medium text-sm truncate">{summarizeProducts(order.products)}</p>
        <p className="text-muted text-xs mt-1">Entrega: {formatShortDate(order.date)}</p>
      </div>
      <Badge status={order.status} />
    </div>
  )
}
