import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import { ListaPrecios, ItemListaPrecios } from '../types'

const COL = 'listas-precios'

export const getAllListasPrecios = async (): Promise<ListaPrecios[]> => {
  try {
    const snap = await getDocs(collection(db, COL))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ListaPrecios))
  } catch {
    return []
  }
}

export const getListaPrecios = async (id: string): Promise<ListaPrecios | null> => {
  try {
    const snap = await getDoc(doc(db, COL, id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as ListaPrecios
  } catch {
    return null
  }
}

export const createListaPrecios = async (
  nombre: string,
  items: ItemListaPrecios[],
): Promise<string> => {
  const ref = await addDoc(collection(db, COL), { nombre, items })
  return ref.id
}

export const updateListaPrecios = (
  id: string,
  data: Partial<Omit<ListaPrecios, 'id'>>,
): Promise<void> => updateDoc(doc(db, COL, id), data)

export const deleteListaPrecios = (id: string): Promise<void> =>
  deleteDoc(doc(db, COL, id))
