import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore'
import { db } from './firebase'

// ── Emails de notificación (admin) ────────────────────────────────────────────

const notifRef = () => doc(db, 'configuracion', 'notificaciones')

export const getNotificationEmails = async (): Promise<string[]> => {
  try {
    const snap = await getDoc(notifRef())
    if (snap.exists()) return (snap.data().emails as string[]) ?? []
    await setDoc(notifRef(), { emails: [] })
    return []
  } catch (err) {
    console.error('[configService] getNotificationEmails:', err)
    return []
  }
}

export const addNotificationEmail = (email: string): Promise<void> =>
  updateDoc(notifRef(), { emails: arrayUnion(email) })

export const removeNotificationEmail = (email: string): Promise<void> =>
  updateDoc(notifRef(), { emails: arrayRemove(email) })
