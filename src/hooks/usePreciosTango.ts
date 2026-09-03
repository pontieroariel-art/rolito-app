import { useCallback } from 'react'
import { subscribePreciosTango } from '../services/preciosTangoService'
import type { EmpresaTango, PreciosTango } from '../utils/precioTango'
import { useSharedSubscription } from './useSharedSubscription'

// Precios y listas de Tango de una empresa (contado → redonhielo, promo →
// rolito). Compartido entre pantallas: es un solo doc con todas las listas.
export function usePreciosTango(empresa: EmpresaTango, opts: { enabled?: boolean } = {}) {
  const subscribe = useCallback(
    (cb: (p: PreciosTango | null) => void) => subscribePreciosTango(empresa, cb),
    [empresa],
  )
  const { data: precios, loading } = useSharedSubscription<PreciosTango | null>(`preciosTango:${empresa}`, subscribe, null, opts)
  return { precios, loading }
}
