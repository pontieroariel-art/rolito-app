import { doc, setDoc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

// Login por legajo — SOLO el número, sin contraseña que el operario tenga que
// tipear (pedido explícito de Ariel, 2026-08-27: simplificar el ingreso en
// planta). Firebase Auth igual necesita una contraseña técnica por debajo —
// se usa esta constante fija, que a propósito NO es secreta (vive en el
// bundle del cliente, cualquiera puede leerla). La seguridad real de esta
// cuenta no depende de esto: produccion_hielo solo puede crear pallets
// INMUTABLES de SU PROPIA planta (ver firestore.rules), nada financiero ni
// sensible — el trade-off (cualquiera que sepa el legajo de otro puede
// loguearse como él) fue aceptado conscientemente dado ese alcance acotado.
const PRODUCCION_PASSWORD_FIJA = 'rolito-produccion-legajo'

export function passwordProduccion(): string {
  return PRODUCCION_PASSWORD_FIJA
}

export function legajoToProduccionEmail(legajo: string): string {
  return `${legajo.replace(/\D/g, '')}@produccion.rolito.internal`
}

export async function setProduccionLegajoIndex(legajo: string, email: string): Promise<void> {
  const key = legajo.replace(/\D/g, '')
  if (!key) return
  await setDoc(doc(db, 'produccionLegajoIndex', key), { email })
}

export async function getEmailByProduccionLegajo(legajo: string): Promise<string | null> {
  const key = legajo.replace(/\D/g, '')
  if (!key) return null
  const snap = await getDoc(doc(db, 'produccionLegajoIndex', key))
  if (!snap.exists()) return null
  return (snap.data() as { email: string }).email
}
