import {
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { Camion, CanalCamion } from '../types'

const FLOTA = 'flota'

export const subscribeCamiones = (
  callback: (camiones: Camion[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, FLOTA), orderBy('patente')),
    (snap) =>
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Camion))),
    () => callback([]),
  )

export const addCamion = (data: {
  patente:          string
  modelo:           string
  marca?:           string
  capacidadPallets?: number
  canales?:         CanalCamion[]
}): Promise<void> =>
  addDoc(collection(db, FLOTA), {
    ...data,
    activo:    true,
    createdAt: serverTimestamp(),
  }).then(() => {})

export const updateCamion = (
  id:   string,
  data: Partial<{ patente: string; modelo: string; marca: string; activo: boolean; capacidadPallets: number; canales: CanalCamion[] }>,
): Promise<void> => updateDoc(doc(db, FLOTA, id), data)

