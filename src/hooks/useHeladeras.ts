import { subscribeHeladeras } from '../services/heladeraService'
import { Heladera } from '../types'
import { useSharedSubscription } from './useSharedSubscription'

const VACIO: Heladera[] = []

// Colección entera (~1700 docs): compartida entre todos los consumidores del
// módulo, ver useSharedSubscription. `enabled: false` no la baja.
export function useHeladeras(opts: { enabled?: boolean } = {}) {
  const { data: heladeras, loading } = useSharedSubscription<Heladera[]>('heladeras', subscribeHeladeras, VACIO, opts)
  return { heladeras, loading }
}
