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

// Login por legajo + PIN individual (mismo patrón que los choferes, ver
// choferAuthService.padPin). Antes se usaba una contraseña FIJA embebida en el
// bundle (ingreso solo con el legajo, pedido de Ariel 2026-08-27 para
// simplificar la operación en planta), pero la auditoría 2026-08-29 la marcó
// como crítica: cualquiera que leyera el bundle y un legajo del índice público
// entraba como ese operario. Ahora el PIN es la contraseña de Auth (NUNCA se
// guarda en Firestore); el sufijo cumple el mínimo de 6 caracteres de Firebase
// Auth cuando el PIN son 4 dígitos.
export function padPinProduccion(pin: string): string {
  return `${pin.replace(/\D/g, '')}__pr`
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
