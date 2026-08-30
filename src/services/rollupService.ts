import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { db } from './firebase'
import { RollupPedidosDia } from '../types'
import { onSnapshotError } from './observability'

const ROLLUPS = 'rollupsPedidos'

// Rollups diarios de pedidos en un rango de fechas (YYYY-MM-DD, inclusive). El
// campo `fecha` coincide con el id del documento; se consulta por rango simple
// (no requiere índice compuesto). Los mantiene el trigger onOrderRollup; acá
// solo se leen. Ver auditoría 2026-08-29 (H5).
export const subscribeRollupsEnRango = (
  desde: string, hasta: string,
  callback: (rollups: RollupPedidosDia[]) => void,
): () => void =>
  onSnapshot(
    query(
      collection(db, ROLLUPS),
      where('fecha', '>=', desde),
      where('fecha', '<=', hasta),
      orderBy('fecha'),
    ),
    (snap) => callback(snap.docs.map((d) => d.data() as RollupPedidosDia)),
    onSnapshotError(callback, 'rollupsPedidos'),
  )
