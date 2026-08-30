import { useAuth } from '../context/AuthContext'
import {
  subscribeClientOrders,
  subscribeAllOrders,
  subscribeKanbanOrders,
  subscribeDriverOrders,
  MAX_ALL_ORDERS,
} from '../services/orderService'
import { Order } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function useClientOrders(): { orders: Order[]; loading: boolean; error: boolean; timedOut: boolean } {
  const { user } = useAuth()
  const { data: orders, loading, error, timedOut } = useFirestoreSubscription<Order[]>(
    (cb, onErr) => user?.uid ? subscribeClientOrders(user.uid, cb, onErr) : (() => {}),
    [user?.uid],
    [],
  )
  return { orders, loading, error, timedOut }
}

export function useAllOrders(): { orders: Order[]; loading: boolean; error: boolean; truncado: boolean } {
  const { data: orders, loading, error } = useFirestoreSubscription<Order[]>(subscribeAllOrders, [], [])
  // Si el stream llegó al tope, hay pedidos que no se están viendo. Los tableros
  // lo muestran con <AvisoDatosTruncados> en vez de mentir en silencio (H5).
  const truncado = orders.length >= MAX_ALL_ORDERS
  return { orders, loading, error, truncado }
}

export function useKanbanOrders(): { orders: Order[]; loading: boolean; error: boolean } {
  const { data: orders, loading, error } = useFirestoreSubscription<Order[]>(subscribeKanbanOrders, [], [])
  return { orders, loading, error }
}

// overrideEmail: undefined = usar email propio; null = no cargar (ayudante sin turno asignado)
export function useDriverOrders(overrideEmail?: string | null): { orders: Order[]; loading: boolean; error: boolean } {
  const { user } = useAuth()
  const email = overrideEmail === undefined ? user?.email : overrideEmail

  const { data: orders, loading, error } = useFirestoreSubscription<Order[]>(
    (cb, onErr) => {
      if (!email) { cb([]); return () => {} }
      return subscribeDriverOrders(email, cb, onErr)
    },
    [email],
    [],
  )
  return { orders, loading, error }
}
