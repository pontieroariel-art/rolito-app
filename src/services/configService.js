import { doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore'
import { db } from './firebase'

const ref = () => doc(db, 'config', 'choferes')

export const getChoferes = async () => {
  try {
    const snap = await getDoc(ref())
    if (snap.exists()) return snap.data().emails ?? []
    // Si el documento no existe, lo crea vacío
    await setDoc(ref(), { emails: [] })
    return []
  } catch {
    return []
  }
}

export const addChofer = (email) =>
  updateDoc(ref(), { emails: arrayUnion(email) })

export const removeChofer = (email) =>
  updateDoc(ref(), { emails: arrayRemove(email) })
