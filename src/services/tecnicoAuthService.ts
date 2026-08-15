import { doc, setDoc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

// Login DNI+PIN como el chofer, pero el email sale directo del DNI (como
// staff) en vez de derivarse de un CUIT — el técnico no tiene CUIT propio.
// Sufijo de PIN distinto (__tec) para no colisionar contraseñas con un
// chofer que comparta el mismo DNI.
export function padPinTecnico(pin: string): string {
  return `${pin}__tec`
}

export function dniToTecnicoEmail(dni: string): string {
  return `${dni.replace(/\D/g, '')}@tecnico.rolito.internal`
}

export async function setTecnicoDniIndex(dni: string, email: string): Promise<void> {
  const key = dni.replace(/\D/g, '')
  if (key.length !== 8) return
  await setDoc(doc(db, 'tecnicoDniIndex', key), { email })
}

export async function getEmailByTecnicoDni(dni: string): Promise<string | null> {
  const key = dni.replace(/\D/g, '')
  if (key.length !== 8) return null
  const snap = await getDoc(doc(db, 'tecnicoDniIndex', key))
  if (!snap.exists()) return null
  return (snap.data() as { email: string }).email
}
