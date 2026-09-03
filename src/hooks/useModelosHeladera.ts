import { subscribeModelosHeladera } from '../services/modelosHeladeraService'
import { ModeloHeladera } from '../types'
import { useSharedSubscription } from './useSharedSubscription'

const VACIO: ModeloHeladera[] = []

export function useModelosHeladera() {
  const { data: modelos, loading } = useSharedSubscription<ModeloHeladera[]>('modelosHeladera', subscribeModelosHeladera, VACIO)
  return { modelos, loading }
}
