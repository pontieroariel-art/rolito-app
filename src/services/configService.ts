import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore'
import { db } from './firebase'

const ref = () => doc(db, 'config', 'choferes')

export const getChoferes = async (): Promise<string[]> => {
  try {
    const snap = await getDoc(ref())
    if (snap.exists()) return (snap.data().emails as string[]) ?? []
    await setDoc(ref(), { emails: [] })
    return []
  } catch {
    return []
  }
}

export const addChofer = (email: string): Promise<void> =>
  updateDoc(ref(), { emails: arrayUnion(email) })

export const removeChofer = (email: string): Promise<void> =>
  updateDoc(ref(), { emails: arrayRemove(email) })
