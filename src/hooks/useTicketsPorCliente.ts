import { subscribeTicketsPorCliente } from '../services/ticketServicioService'
import { TicketServicio } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function useTicketsPorCliente(clientId: string | null) {
  const { data: tickets, loading } = useFirestoreSubscription<TicketServicio[]>(
    (cb) => {
      if (!clientId) { cb([]); return () => {} }
      return subscribeTicketsPorCliente(clientId, cb)
    },
    [clientId],
    [],
  )
  return { tickets, loading }
}
