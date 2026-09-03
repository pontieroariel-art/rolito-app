import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from './firebase'
import type { EmpresaTango, PreciosTango } from '../utils/precioTango'
import { onSnapshotError } from './observability'

// preciosTango/{empresa}: precios y listas sincronizados desde Tango (los
// escribe la Cloud Function syncPreciosTango; ver utils/precioTango.ts).
export const subscribePreciosTango = (
  empresa: EmpresaTango,
  callback: (precios: PreciosTango | null) => void,
): (() => void) =>
  onSnapshot(
    doc(db, 'preciosTango', empresa),
    (snap: DocumentSnapshot) => callback(snap.exists() ? (snap.data() as PreciosTango) : null),
    onSnapshotError(() => callback(null), 'preciosTango'),
  )

export interface ResumenSyncPrecios {
  empresas: Record<string, { listas: number; productos: number; especiales: number; errores: string[]; clientesConLista: number }>
  usuariosActualizados: number
}

/** Botón "Sincronizar ahora": corre la misma sync que la programada. */
export async function sincronizarPreciosTangoAhora(): Promise<ResumenSyncPrecios> {
  const fn = httpsCallable<void, ResumenSyncPrecios>(getFunctions(), 'sincronizarPreciosTangoAhora')
  return (await fn()).data
}
