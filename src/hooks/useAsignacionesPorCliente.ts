import { subscribeAsignacionesPorCliente } from '../services/asignacionHeladeraService'
import { AsignacionHeladera } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function useAsignacionesPorCliente(clientId: string | null) {
  const { data: asignaciones, loading, timedOut } = useFirestoreSubscription<AsignacionHeladera[]>(
    (cb) => {
      if (!clientId) { cb([]); return () => {} }
      return subscribeAsignacionesPorCliente(clientId, cb)
    },
    [clientId],
    [],
  )
  return { asignaciones, loading, timedOut }
}
