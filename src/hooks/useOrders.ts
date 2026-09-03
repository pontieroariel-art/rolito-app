import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import {
  subscribeClientOrders,
  subscribeAllOrders,
  subscribeKanbanOrders,
  subscribeDriverOrders,
  getOrdersInRange,
  getOrdersActualizadosDesde,
  MAX_ALL_ORDERS,
} from '../services/orderService'
import { Order } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'
import { useSharedSubscription } from './useSharedSubscription'

export function useClientOrders(): { orders: Order[]; loading: boolean; error: boolean; timedOut: boolean } {
  const { user } = useAuth()
  const { data: orders, loading, error, timedOut } = useFirestoreSubscription<Order[]>(
    (cb, onErr) => user?.uid ? subscribeClientOrders(user.uid, cb, onErr) : (() => {}),
    [user?.uid],
    [],
  )
  return { orders, loading, error, timedOut }
}

const SIN_PEDIDOS: Order[] = []

// Stream de todos los pedidos (tope MAX_ALL_ORDERS): lo abren seis pantallas
// de gerencia/comercial/monitoreo, así que se comparte (useSharedSubscription).
export function useAllOrders(): { orders: Order[]; loading: boolean; error: boolean; truncado: boolean } {
  const { data: orders, loading, error } = useSharedSubscription<Order[]>('allOrders', subscribeAllOrders, SIN_PEDIDOS)
  // Si el stream llegó al tope, hay pedidos que no se están viendo. Los tableros
  // lo muestran con <AvisoDatosTruncados> en vez de mentir en silencio (H5).
  const truncado = orders.length >= MAX_ALL_ORDERS
  return { orders, loading, error, truncado }
}

// Reporte por rango: pedidos con `date` en [desde, hasta] (Historial de
// /movimientos y de comercial). Query puntual cacheada por React Query, keyed
// por el rango — reemplaza el viejo stream fijo de 30 días que dejaba cualquier
// mes/año pasado vacío. Pasá Dates ESTABLES (useMemo) para no re-fetchear en
// cada render. staleTime corto + refetch al volver a la pestaña ⇒ el período
// actual se mantiene fresco sin socket permanente.
export function useOrdersRango(desde: Date, hasta: Date): { orders: Order[]; loading: boolean; error: boolean } {
  const { data: orders = [], isLoading, isError } = useQuery({
    queryKey:  ['ordersRango', desde.getTime(), hasta.getTime()],
    queryFn:   () => getOrdersInRange(desde, hasta),
    staleTime: 60_000,
  })
  return { orders, loading: isLoading, error: isError }
}

// Reporte de incidencias: pedidos con updatedAt desde `desde` (ventana móvil de
// N días). Va por updatedAt y no por date porque un pedido reprogramado tiene
// fecha de entrega futura pero updatedAt reciente. Ver getOrdersActualizadosDesde.
export function useOrdersActualizadosDesde(desde: Date): { orders: Order[]; loading: boolean; error: boolean } {
  const { data: orders = [], isLoading, isError } = useQuery({
    queryKey:  ['ordersActualizados', desde.getTime()],
    queryFn:   () => getOrdersActualizadosDesde(desde),
    staleTime: 60_000,
  })
  return { orders, loading: isLoading, error: isError }
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
