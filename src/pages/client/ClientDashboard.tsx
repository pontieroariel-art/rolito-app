import { useEffect, useRef, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useBranch } from '../../context/BranchContext'
import { usePushNotification } from '../../hooks/usePushNotification'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useClientOrders } from '../../hooks/useOrders'
import { useAuth } from '../../context/AuthContext'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { savePushSubscription } from '../../services/userService'
import { Order, OrderStatus, getPrimaryAddress } from '../../types'
import { summarizeProducts } from '../../utils/helpers'
import { StatCard }      from '../../components/client/StatCard'
import { TruckTracker }  from '../../components/client/TruckTracker'
import { ClientWeather } from '../../components/client/ClientWeather'
import { RecurrenteCard } from '../../components/client/RecurrenteCard'
import { OrderRow }      from '../../components/client/OrderRow'

export default function ClientDashboard() {
  const { user }               = useAuth()
  const { orders, loading }    = useClientOrders()
  const { selectedAddress }    = useBranch()
  const navigate               = useNavigate()
  const { isLoaded }           = useGoogleMapsLoader()

  const multiSucursal = (user?.addresses?.length ?? 0) > 1

  const branchOrders = useMemo(() => {
    if (!multiSucursal || !selectedAddress) return orders
    return orders.filter((o) => o.clientAddress === selectedAddress.address)
  }, [orders, multiSucursal, selectedAddress])

  const active        = branchOrders.filter((o) => !['entregado', 'cancelado'].includes(o.status))
  const delivered     = branchOrders.filter((o) => o.status === 'entregado')
  const recent        = branchOrders.slice(0, 5)
  const enCaminoOrder = branchOrders.find((o) => o.status === 'en_camino') ?? null
  const primaryAddr   = selectedAddress ?? (user ? getPrimaryAddress(user) : null)
  const hasAddress    = !!(primaryAddr?.address || user?.address)

  const lastOrder = orders.find(
    (o) => o.status !== 'cancelado' && o.products.some((p) => p.productoId),
  )

  const { permission, request, notify } = usePushNotification()

  const initializedRef  = useRef(false)
  const prevStatusesRef = useRef<Record<string, OrderStatus>>({})
  useEffect(() => {
    if (orders.length === 0) return
    if (!initializedRef.current) {
      orders.forEach((o) => { prevStatusesRef.current[o.id] = o.status })
      initializedRef.current = true
      return
    }
    orders.forEach((o) => {
      const prev = prevStatusesRef.current[o.id]
      if (prev && prev !== o.status && o.status === 'en_camino') {
        notify('Tu pedido está en camino 🚛', summarizeProducts(o.products))
      }
      prevStatusesRef.current[o.id] = o.status
    })
  }, [orders, notify])

  if (loading) return <div className="min-h-screen bg-white"><Navbar /><LoadingSpinner fullScreen /></div>

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Hola, {(user?.nombreContacto || user?.nombre)?.split(' ')[0] ?? 'amigo'} 👋
          </h1>
          {multiSucursal && selectedAddress ? (
            <div className="flex items-center gap-2 mt-1">
              <p className="text-accent text-sm font-medium">📍 {selectedAddress.nombre}</p>
              <Link to="/sucursal" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
                Cambiar →
              </Link>
            </div>
          ) : (
            <p className="text-gray-500 text-sm mt-1">Gestión de pedidos de hielo</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Pedidos activos"    value={active.length}    color="text-accent" />
          <StatCard label="Pedidos entregados" value={delivered.length} color="text-accent" />
        </div>

        {permission === 'default' && (
          <div className="bg-[#E8F5F0] border border-[#B3DDD3] rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Activar notificaciones</p>
              <p className="text-xs text-gray-500 mt-0.5">Avisamos cuando tu pedido sale y cuando el camión está cerca</p>
            </div>
            <button
              onClick={() => request(user?.uid ? (sub) => savePushSubscription(user.uid, sub) : undefined)}
              className="shrink-0 bg-accent text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-accent/90 transition-colors"
            >
              Activar
            </button>
          </div>
        )}

        {enCaminoOrder && (
          <TruckTracker
            order={enCaminoOrder}
            clientEmail={user?.email ?? ''}
            clientNombre={(user?.nombreContacto || user?.nombre || '').split(' ')[0] || 'Cliente'}
            onNearby={() => notify('Tu pedido llega en minutos ⏱️', 'El camión está a menos de 500 metros')}
          />
        )}

        {!hasAddress && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm">
            <p className="text-amber-700 font-medium">⚠ Completá tu perfil</p>
            <p className="text-amber-600/80 mt-1">
              Necesitás agregar una dirección de entrega para hacer pedidos.{' '}
              <Link to="/perfil" className="underline hover:text-amber-700">Ir a Mi perfil →</Link>
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Link
            to="/nuevo-pedido"
            className="flex items-center justify-center gap-2 w-full bg-accent text-white font-semibold py-3.5 rounded-2xl hover:bg-accent/90 transition-colors text-sm"
          >
            + Hacer nuevo pedido
          </Link>

          {lastOrder && (
            <button
              onClick={() => navigate('/nuevo-pedido', { state: { repeatOrder: lastOrder } })}
              className="w-full flex items-center justify-between gap-3 bg-white border border-gray-200 hover:border-accent/50 rounded-2xl px-4 py-3 text-sm transition-colors group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-gray-400 group-hover:text-accent transition-colors shrink-0">↩</span>
                <div className="text-left min-w-0">
                  <p className="text-xs text-gray-400">Repetir último pedido</p>
                  <p className="text-gray-900 truncate text-sm">{summarizeProducts(lastOrder.products)}</p>
                </div>
              </div>
              <span className="text-gray-400 text-xs shrink-0 group-hover:text-accent transition-colors">→</span>
            </button>
          )}
        </div>

        <RecurrenteCard user={user} />

        <ClientWeather
          address={selectedAddress?.address || primaryAddr?.address || user?.address || ''}
          isLoaded={isLoaded}
        />

        <section>
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Pedidos recientes</h2>
            {orders.length > 5 && (
              <Link to="/historial" className="text-accent text-sm hover:underline">Ver todos</Link>
            )}
          </div>

          {recent.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
              <p className="text-gray-400 text-sm">Aún no tenés pedidos</p>
              <p className="text-gray-300 text-xs mt-1">Hacé tu primer pedido usando el botón de arriba</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recent.map((order: Order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
