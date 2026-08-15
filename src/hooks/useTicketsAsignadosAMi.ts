import { subscribeTicketsAsignadosA } from '../services/ticketServicioService'
import { TicketServicio } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function useTicketsAsignadosAMi(uid: string | null) {
  const { data: tickets, loading } = useFirestoreSubscription<TicketServicio[]>(
    (cb) => {
      if (!uid) { cb([]); return () => {} }
      return subscribeTicketsAsignadosA(uid, cb)
    },
    [uid],
    [],
  )
  return { tickets, loading }
}
