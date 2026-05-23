import { doc, setDoc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/\s+/g, '.')
}

export function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@chofer.rolito.internal`
}

// Firebase Auth exige mínimo 6 caracteres; el PIN real son 4 dígitos.
// Se agrega un sufijo fijo interno para cumplir el requisito.
export function padPin(pin: string): string {
  return `${pin}__ch`
}

export async function setChoferIndex(username: string, email: string): Promise<void> {
  const key = normalizeUsername(username)
  await setDoc(doc(db, 'choferIndex', key), { email })
}

export async function getEmailByUsername(username: string): Promise<string | null> {
  const key = normalizeUsername(username)
  if (!key) return null
  const snap = await getDoc(doc(db, 'choferIndex', key))
  if (!snap.exists()) return null
  return (snap.data() as { email: string }).email
}
