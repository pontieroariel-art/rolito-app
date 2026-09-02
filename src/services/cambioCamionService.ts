import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import { CambioCamion } from '../types'

const CAMBIOS = 'cambiosCamion'

// Registro HISTÓRICO de cambios.
//
// Hasta 2026-09-02 un cambio era una operación aparte, con su propia pantalla,
// y caía en esta colección. Hoy el cambio es un renglón de la venta
// (`ventasCamion.cambios`, en $0) para que salga en el mismo comprobante que
// firma el cliente — ver utils/cambios.ts. Acá ya no se escribe nada; se sigue
// leyendo para que los días anteriores a la migración liquiden igual.

// Cambios de un chofer en un rango (para la liquidación y su propio resumen).
export const subscribeCambiosChoferEnRango = (
  choferId: string,
  desde: Date, hasta: Date,
  callback: (cambios: CambioCamion[]) => void,
): () => void =>
  onSnapshot(
    query(
      collection(db, CAMBIOS),
      where('choferId', '==', choferId),
      where('fecha', '>=', Timestamp.fromDate(desde)),
      where('fecha', '<', Timestamp.fromDate(hasta)),
    ),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CambioCamion))),
    onSnapshotError(callback, 'cambiosCamion'),
  )
