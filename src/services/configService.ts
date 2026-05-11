import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore'
import { db } from './firebase'

// ── Choferes ──────────────────────────────────────────────────────────────────

const choferesRef = () => doc(db, 'config', 'choferes')

export const getChoferes = async (): Promise<string[]> => {
  try {
    const snap = await getDoc(choferesRef())
    if (snap.exists()) return (snap.data().emails as string[]) ?? []
    await setDoc(choferesRef(), { emails: [] })
    return []
  } catch {
    return []
  }
}

export const addChofer = (email: string): Promise<void> =>
  updateDoc(choferesRef(), { emails: arrayUnion(email) })

export const removeChofer = (email: string): Promise<void> =>
  updateDoc(choferesRef(), { emails: arrayRemove(email) })

// ── Emails de notificación (admin) ────────────────────────────────────────────

const notifRef = () => doc(db, 'configuracion', 'notificaciones')

export const getNotificationEmails = async (): Promise<string[]> => {
  try {
    const snap = await getDoc(notifRef())
    if (snap.exists()) return (snap.data().emails as string[]) ?? []
    await setDoc(notifRef(), { emails: [] })
    return []
  } catch {
    return []
  }
}

export const addNotificationEmail = (email: string): Promise<void> =>
  updateDoc(notifRef(), { emails: arrayUnion(email) })

export const removeNotificationEmail = (email: string): Promise<void> =>
  updateDoc(notifRef(), { emails: arrayRemove(email) })
