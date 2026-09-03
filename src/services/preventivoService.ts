import { collection, doc, deleteDoc, setDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import { Preventivo } from '../types'

const PREVENTIVOS = 'preventivos'

export interface Actor { uid: string; nombre: string }

const preventivoId = (clientId: string, year: number) => `${clientId}_${year}`

// Solo trae los que están marcados como hechos — el resto de los clientes se
// asume pendiente por default (no hace falta un doc por cada uno).
export const subscribePreventivosDelAnio = (
  year: number,
  callback: (preventivos: Preventivo[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, PREVENTIVOS), where('year', '==', year)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Preventivo))),
    onSnapshotError(callback, 'preventivos'),
  )

export const marcarPreventivoHecho = (clientId: string, year: number, actor: Actor): Promise<void> =>
  setDoc(doc(db, PREVENTIVOS, preventivoId(clientId, year)), {
    clientId, year, hecho: true, actor, fecha: serverTimestamp(),
  })

export const desmarcarPreventivo = (clientId: string, year: number): Promise<void> =>
  deleteDoc(doc(db, PREVENTIVOS, preventivoId(clientId, year)))
