import { ZonaProhibida, subscribeZonas } from '../services/zonasService'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function useZonasProhibidas() {
  const { data: zonas } = useFirestoreSubscription<ZonaProhibida[]>(subscribeZonas, [], [])
  return { zonas }
}
