import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import { ModeloHeladera } from '../types'

const MODELOS = 'modelosHeladera'

export const getModeloHeladera = async (id: string): Promise<ModeloHeladera | null> => {
  const snap = await getDoc(doc(db, MODELOS, id))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as ModeloHeladera) : null
}

export const subscribeModelosHeladera = (
  callback: (modelos: ModeloHeladera[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, MODELOS), orderBy('nombre'), limit(200)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ModeloHeladera))),
    onSnapshotError(callback, 'modelosHeladera'),
  )

export const crearModeloHeladera = (data: {
  nombre: string
  medidas: { ancho: number; alto: number; profundo: number }
  capacidadBolsas: number
  fotoUrl?: string
  prefijoCodigo?: string
}): Promise<void> =>
  addDoc(collection(db, MODELOS), {
    ...data,
    activo:    true,
    proximoNumero: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }).then(() => {})

export const actualizarModeloHeladera = (
  id:   string,
  data: Partial<{
    nombre: string
    medidas: { ancho: number; alto: number; profundo: number }
    capacidadBolsas: number
    fotoUrl: string
    activo: boolean
    prefijoCodigo: string
  }>,
): Promise<void> =>
  updateDoc(doc(db, MODELOS, id), { ...data, updatedAt: serverTimestamp() })
