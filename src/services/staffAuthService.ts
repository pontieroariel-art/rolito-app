import { doc, setDoc, getDoc } from 'firebase/firestore'
import { signInAnonymously } from 'firebase/auth'
import { db, auth } from './firebase'

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/\s+/g, '.')
}

export function usernameToStaffEmail(username: string): string {
  return `${normalizeUsername(username)}@staff.rolito.internal`
}

export async function setStaffIndex(username: string, email: string): Promise<void> {
  const key = normalizeUsername(username)
  await setDoc(doc(db, 'staffIndex', key), { email })
}

export async function getEmailByStaffUsername(username: string): Promise<string | null> {
  const key = normalizeUsername(username)
  if (!key) return null
  if (!auth.currentUser) {
    await signInAnonymously(auth)
  }
  const snap = await getDoc(doc(db, 'staffIndex', key))
  if (!snap.exists()) return null
  return (snap.data() as { email: string }).email
}
