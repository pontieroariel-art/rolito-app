import { subscribeModelosHeladera } from '../services/modelosHeladeraService'
import { ModeloHeladera } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export function useModelosHeladera() {
  const { data: modelos, loading } = useFirestoreSubscription<ModeloHeladera[]>(subscribeModelosHeladera, [], [])
  return { modelos, loading }
}
