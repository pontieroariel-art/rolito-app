import { subscribeHeladerasPorCliente } from '../services/heladeraService'
import { Heladera } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function useHeladerasPorCliente(clientId: string | null) {
  const { data: heladeras, loading, timedOut } = useFirestoreSubscription<Heladera[]>(
    (cb) => {
      if (!clientId) { cb([]); return () => {} }
      return subscribeHeladerasPorCliente(clientId, cb)
    },
    [clientId],
    [],
  )
  return { heladeras, loading, timedOut }
}
