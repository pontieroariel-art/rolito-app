import { subscribeTicketsRecientes } from '../services/ticketServicioService'
import { TicketServicio } from '../types'
import { useSharedSubscription } from './useSharedSubscription'

const VACIO: TicketServicio[] = []

export function useTicketsServicio() {
  const { data: tickets, loading } = useSharedSubscription<TicketServicio[]>('ticketsRecientes', subscribeTicketsRecientes, VACIO)
  return { tickets, loading }
}
