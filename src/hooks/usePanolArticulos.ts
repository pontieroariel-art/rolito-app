import { subscribeArticulos } from '../services/panolService'
import { PanolArticulo } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function usePanolArticulos() {
  const { data: articulos, loading } = useFirestoreSubscription<PanolArticulo[]>(subscribeArticulos, [], [])
  return { articulos, loading }
}
