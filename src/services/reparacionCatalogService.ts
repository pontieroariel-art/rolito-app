import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { MotivoReparacion, TipoReparacion } from '../types'

const motivosRef = () => doc(db, 'config', 'motivosReparacion')
const tiposRef   = () => doc(db, 'config', 'tiposReparacion')

export const getMotivosReparacion = async (): Promise<MotivoReparacion[]> => {
  try {
    const snap = await getDoc(motivosRef())
    if (snap.exists()) return (snap.data().items as MotivoReparacion[]) ?? []
    await setDoc(motivosRef(), { items: [] })
    return []
  } catch {
    return []
  }
}

export const saveMotivosReparacion = (items: MotivoReparacion[]): Promise<void> =>
  setDoc(motivosRef(), { items })

export const getTiposReparacion = async (): Promise<TipoReparacion[]> => {
  try {
    const snap = await getDoc(tiposRef())
    if (snap.exists()) return (snap.data().items as TipoReparacion[]) ?? []
    await setDoc(tiposRef(), { items: [] })
    return []
  } catch {
    return []
  }
}

export const saveTiposReparacion = (items: TipoReparacion[]): Promise<void> =>
  setDoc(tiposRef(), { items })
