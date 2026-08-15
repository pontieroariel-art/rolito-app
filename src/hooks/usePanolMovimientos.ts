import { subscribeMovimientosRecientes, subscribeMovimientosAsignadosA } from '../services/panolService'
import { PanolMovimiento } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function usePanolMovimientos() {
  const { data: movimientos, loading } = useFirestoreSubscription<PanolMovimiento[]>(subscribeMovimientosRecientes, [], [])
  return { movimientos, loading }
}

export function usePanolMovimientosAsignadosA(uid: string | null) {
  const { data: movimientos, loading } = useFirestoreSubscription<PanolMovimiento[]>(
    (cb) => {
      if (!uid) { cb([]); return () => {} }
      return subscribeMovimientosAsignadosA(uid, cb)
    },
    [uid],
    [],
  )
  return { movimientos, loading }
}
