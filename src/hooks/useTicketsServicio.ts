import { subscribeTicketsRecientes } from '../services/ticketServicioService'
import { TicketServicio } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function useTicketsServicio() {
  const { data: tickets, loading } = useFirestoreSubscription<TicketServicio[]>(subscribeTicketsRecientes, [], [])
  return { tickets, loading }
}
