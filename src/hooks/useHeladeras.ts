import { subscribeHeladeras } from '../services/heladeraService'
import { Heladera } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function useHeladeras() {
  const { data: heladeras, loading } = useFirestoreSubscription<Heladera[]>(subscribeHeladeras, [], [])
  return { heladeras, loading }
}
