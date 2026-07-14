import { subscribeCamiones } from '../services/flotaService'
import { Camion } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function useFlota() {
  const { data: camiones, loading } = useFirestoreSubscription<Camion[]>(subscribeCamiones, [], [])
  return { camiones, loading }
}
