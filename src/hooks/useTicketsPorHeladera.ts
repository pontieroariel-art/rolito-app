import { subscribeTicketsPorHeladera } from '../services/ticketServicioService'
import { TicketServicio } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function useTicketsPorHeladera(heladeraId: string | null) {
  const { data: tickets, loading } = useFirestoreSubscription<TicketServicio[]>(
    (cb) => {
      if (!heladeraId) { cb([]); return () => {} }
      return subscribeTicketsPorHeladera(heladeraId, cb)
    },
    [heladeraId],
    [],
  )
  return { tickets, loading }
}
