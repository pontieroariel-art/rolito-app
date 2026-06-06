import { doc, setDoc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

export function normalizeCuit(cuit: string): string {
  return cuit.replace(/\D/g, '')
}

export function formatCuit(cuit: string): string {
  const d = normalizeCuit(cuit)
  if (d.length !== 11) return cuit
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
}

export async function setCuitIndex(cuit: string, email: string): Promise<void> {
  const key = normalizeCuit(cuit)
  if (key.length !== 11) return
  await setDoc(doc(db, 'cuitIndex', key), { email })
}

export async function getEmailByCuit(cuit: string): Promise<string | null> {
  const key = normalizeCuit(cuit)
  if (!key) return null
  const snap = await getDoc(doc(db, 'cuitIndex', key))
  if (!snap.exists()) return null
  return (snap.data() as { email: string }).email
}
