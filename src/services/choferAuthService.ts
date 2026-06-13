import { doc, setDoc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

export function padPin(pin: string): string {
  return `${pin}__ch`
}

export function dniFromCuit(cuit: string): string {
  return cuit.replace(/\D/g, '').slice(2, 10)
}

export async function setDniIndex(cuit: string, email: string): Promise<void> {
  const dni = dniFromCuit(cuit)
  if (dni.length !== 8) return
  await setDoc(doc(db, 'dniIndex', dni), { email, cuit: cuit.replace(/\D/g, '') })
}

export async function getEmailByDni(dni: string): Promise<string | null> {
  const key = dni.replace(/\D/g, '')
  if (!key || key.length !== 8) return null
  const snap = await getDoc(doc(db, 'dniIndex', key))
  if (!snap.exists()) return null
  return (snap.data() as { email: string }).email
}
