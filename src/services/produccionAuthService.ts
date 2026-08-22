import { doc, setDoc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

// Login DNI+PIN como técnico/chofer — el email sale directo del DNI. Sufijo
// de PIN propio (__prod) para no colisionar contraseñas con un técnico o
// chofer que comparta el mismo DNI.
export function padPinProduccion(pin: string): string {
  return `${pin}__prod`
}

export function dniToProduccionEmail(dni: string): string {
  return `${dni.replace(/\D/g, '')}@produccion.rolito.internal`
}

export async function setProduccionDniIndex(dni: string, email: string): Promise<void> {
  const key = dni.replace(/\D/g, '')
  if (key.length !== 8) return
  await setDoc(doc(db, 'produccionDniIndex', key), { email })
}

export async function getEmailByProduccionDni(dni: string): Promise<string | null> {
  const key = dni.replace(/\D/g, '')
  if (key.length !== 8) return null
  const snap = await getDoc(doc(db, 'produccionDniIndex', key))
  if (!snap.exists()) return null
  return (snap.data() as { email: string }).email
}
