import { useCallback } from 'react'
import { subscribeHeladerasPorCliente } from '../services/heladeraService'
import { Heladera } from '../types'
import { useSharedSubscription } from './useSharedSubscription'

const VACIO: Heladera[] = []

export function useHeladerasPorCliente(clientId: string | null) {
  const subscribe = useCallback(
    (cb: (h: Heladera[]) => void) => {
      if (!clientId) { cb(VACIO); return () => {} }
      return subscribeHeladerasPorCliente(clientId, cb)
    },
    [clientId],
  )
  const { data: heladeras, loading, timedOut } = useSharedSubscription<Heladera[]>(
    `heladerasPorCliente:${clientId ?? '-'}`, subscribe, VACIO, { enabled: !!clientId, keepAliveMs: 10_000 },
  )
  return { heladeras, loading, timedOut }
}
