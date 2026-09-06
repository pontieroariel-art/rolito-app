import { collection, doc, onSnapshot, orderBy, query, setDoc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import type { DepositoTango, TipoDeposito } from '../types'

// Catálogo de depósitos de Tango (depositosTango/{codigo}). Lo crea y refresca
// la sync (functions/src/services/tango/depositos.ts); acá solo se leen y se
// editan los campos de la app: tipo, activo y usuario vinculado. Al vincular
// un usuario se refleja en config/tango.depositos (uid → código), que es lo
// que leen los writers de Tango para las ventas anteriores a este cambio.

const DEPOSITOS = 'depositosTango'

export function subscribeDepositosTango(cb: (depositos: DepositoTango[]) => void, onError?: (err: Error) => void): () => void {
  return onSnapshot(
    query(collection(db, DEPOSITOS), orderBy('codigo')),
    (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<DepositoTango, 'codigo'>), codigo: d.id }))),
    onError ?? onSnapshotError(cb, DEPOSITOS),
  )
}

export async function actualizarDepositoTango(
  codigo: string,
  cambios: { tipo?: TipoDeposito; activo?: boolean; usuario?: { uid: string; nombre: string; rol: string } | null },
): Promise<void> {
  const update: Record<string, unknown> = { editadoEn: serverTimestamp() }
  if (cambios.tipo !== undefined) update.tipo = cambios.tipo
  if (cambios.activo !== undefined) update.activo = cambios.activo
  if (cambios.usuario !== undefined) {
    update.uid = cambios.usuario?.uid ?? null
    update.usuarioNombre = cambios.usuario?.nombre ?? null
    update.usuarioRol = cambios.usuario?.rol ?? null
  }
  await updateDoc(doc(db, DEPOSITOS, codigo), update)
  if (cambios.usuario !== undefined) await reflejarVinculoEnConfig(codigo, cambios.usuario?.uid ?? null)
}

// Espejo uid → código en config/tango.depositos: los writers de Tango lo usan
// como respaldo cuando el doc de la venta no trae depositoTango. Al vincular
// un uid a un código se borran los uids que apuntaban a ese código antes.
async function reflejarVinculoEnConfig(codigo: string, uid: string | null): Promise<void> {
  const { getDoc } = await import('firebase/firestore')
  const cfg = (await getDoc(doc(db, 'config', 'tango'))).data() ?? {}
  const actual = (cfg.depositos ?? {}) as Record<string, string>
  const update: Record<string, unknown> = {}
  for (const [u, cod] of Object.entries(actual)) if (cod === codigo && u !== uid) update[`depositos.${u}`] = deleteField()
  if (uid) update[`depositos.${uid}`] = codigo
  if (Object.keys(update).length) await setDoc(doc(db, 'config', 'tango'), {}, { merge: true }).then(() => updateDoc(doc(db, 'config', 'tango'), update))
}

export interface ResumenSyncDepositos { recibidos: number; nuevos: number; actualizados: number; inhabilitados: number }

export async function sincronizarDepositosTangoAhora(): Promise<ResumenSyncDepositos> {
  const fn = httpsCallable<void, ResumenSyncDepositos>(getFunctions(), 'sincronizarDepositosTangoAhora', { timeout: 5 * 60_000 })
  return (await fn()).data
}
