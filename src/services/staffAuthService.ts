import { doc, setDoc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

export function dniToStaffEmail(dni: string): string {
  return `${dni.replace(/\D/g, '')}@staff.rolito.internal`
}

export async function setStaffDniIndex(dni: string, email: string): Promise<void> {
  const key = dni.replace(/\D/g, '')
  if (key.length !== 8) return
  await setDoc(doc(db, 'staffDniIndex', key), { email })
}

export async function getEmailByStaffDni(dni: string): Promise<string | null> {
  const key = dni.replace(/\D/g, '')
  // Igual que dniIndex/cuitIndex: exigir longitud exacta, no solo "no vacío".
  // La UI actual ya trunca a 8 dígitos así que hoy no es explotable, pero sin
  // este chequeo cualquier cambio futuro en el input dejaría de estar protegido.
  if (key.length !== 8) return null
  const snap = await getDoc(doc(db, 'staffDniIndex', key))
  if (!snap.exists()) return null
  return (snap.data() as { email: string }).email
}
