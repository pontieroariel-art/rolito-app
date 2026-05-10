import { useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useDriverOrders } from '../../hooks/useOrders'
import { updateOrderStatus } from '../../services/orderService'
import { summarizeProducts } from '../../utils/helpers'
import { Order } from '../../types'

export default function ChoferDashboard() {
  const { orders, loading } = useDriverOrders()

  const pending   = orders.filter((o) => o.status !== 'entregado')
  const delivered = orders.filter((o) => o.status === 'entregado')

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-start gap-3">
          <div>
            <h1 className="text-2xl font-bold">Mis entregas de hoy</h1>
            <p className="text-muted text-sm">
              {new Date().toLocaleDateString('es-AR', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </p>
          </div>
          {pending.length > 0 && (
            <Link to="/chofer/map">
              <Button className="text-sm">🗺 Ver ruta en mapa</Button>
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="text-muted text-sm">Pendientes</p>
            <p className="text-4xl font-bold text-accent mt-1">{pending.length}</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="text-muted text-sm">Entregados</p>
            <p className="text-4xl font-bold text-success mt-1">{delivered.length}</p>
          </div>
        </div>

        {orders.length === 0 && (
          <div className="bg-surface border border-border rounded-xl p-10 text-center">
            <p className="text-4xl mb-3">📦</p>
            <p className="text-muted">No tenés entregas asignadas para hoy</p>
          </div>
        )}

        {pending.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Por entregar</h2>
            <div className="space-y-3">
              {pending.map((o, i) => (
                <DeliveryCard key={o.id} order={o} index={i + 1} />
              ))}
            </div>
          </section>
        )}

        {delivered.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3 text-success">✓ Entregados</h2>
            <div className="space-y-2">
              {delivered.map((o) => (
                <div
                  key={o.id}
                  className="bg-surface border border-success/20 rounded-xl p-3 opacity-60"
                >
                  <p className="font-medium text-sm">{o.clientName}</p>
                  <p className="text-muted text-xs">{o.clientAddress}</p>
                  <p className="text-xs text-muted mt-1">{summarizeProducts(o.products)}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  )
}

function DeliveryCard({ order, index }: { order: Order; index: number }) {
  const [loading, setLoading] = useState(false)

  const markDelivered = async () => {
    setLoading(true)
    await updateOrderStatus(order.id, 'entregado')
    setLoading(false)
  }

  const openInMaps = () => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.clientAddress)}`
    window.open(url, '_blank')
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
      <div className="flex justify-between items-start gap-3">
        <div className="flex items-start gap-3">
          <span className="w-7 h-7 rounded-full bg-accent/20 text-accent text-sm flex items-center justify-center font-bold shrink-0 mt-0.5">
            {index}
          </span>
          <div>
            <p className="font-semibold">{order.clientName}</p>
            <p className="text-muted text-sm">{order.clientAddress}</p>
            {order.clientPhone && (
              <a
                href={`tel:${order.clientPhone}`}
                className="text-accent text-sm hover:underline"
              >
                📞 {order.clientPhone}
              </a>
            )}
          </div>
        </div>
        <Badge status={order.status} />
      </div>

      <p className="text-sm text-white pl-10">{summarizeProducts(order.products)}</p>

      {order.notes && (
        <p className="text-xs text-muted italic pl-10">"{order.notes}"</p>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={openInMaps} className="flex-1 text-sm py-2">
          📍 Abrir en Maps
        </Button>
        <Button onClick={markDelivered} loading={loading} variant="success" className="flex-1 text-sm py-2">
          ✓ Entregado
        </Button>
      </div>
    </div>
  )
}
