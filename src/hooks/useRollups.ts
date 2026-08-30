import { useMemo } from 'react'
import { RollupPedidosDia } from '../types'
import { subscribeRollupsEnRango } from '../services/rollupService'
import { useFirestoreSubscription } from './useFirestoreSubscription'
import { useDiaActual } from './useDiaActual'
import { addDaysStr } from '../utils/helpers'

// Rollups diarios de los últimos `dias` días (incluye hoy), reactivo al cruzar
// la medianoche. Para los tableros de gerencia: reemplaza escanear todos los
// pedidos (que se truncaban en silencio a escala — auditoría H5).
export function useRollupsUltimosDias(dias: number): { rollups: RollupPedidosDia[]; loading: boolean } {
  const hoy   = useDiaActual()
  const desde = useMemo(() => addDaysStr(hoy, -(dias - 1)), [hoy, dias])
  const { data: rollups, loading } = useFirestoreSubscription<RollupPedidosDia[]>(
    (cb) => subscribeRollupsEnRango(desde, hoy, cb),
    [desde, hoy],
    [],
  )
  return { rollups, loading }
}
