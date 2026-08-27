import { doc, setDoc, getDoc } from 'firebase/firestore'
import { db } from './firebase'
import { PlantaId } from '../types'

// Marca este dispositivo como "tablet de planta X" en localStorage (no
// sessionStorage: tiene que sobrevivir a cerrar y reabrir la app instalada,
// no solo a la pestaña). Landing.tsx la usa para mandar "/" derecho a
// produccion-{planta} en vez del landing genérico — así el logout nunca
// muestra Clientes/Choferes/Equipo Rolito. Ver Navbar.tsx para el porqué no
// se resuelve con un navigate() en el logout (pierde la carrera contra el
// redirect de ProtectedRoute).
const DISPOSITIVO_PRODUCCION_KEY = 'produccionPlantaDevice'

export function marcarDispositivoProduccion(planta: PlantaId): void {
  try { localStorage.setItem(DISPOSITIVO_PRODUCCION_KEY, planta) } catch { /* localStorage puede fallar en privado/incognito, no es crítico */ }
}

export function getDispositivoProduccion(): PlantaId | null {
  try {
    const v = localStorage.getItem(DISPOSITIVO_PRODUCCION_KEY)
    return v === 'torcuato' || v === 'merlo' ? v : null
  } catch {
    return null
  }
}

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
