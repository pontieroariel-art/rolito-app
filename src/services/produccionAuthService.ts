import { doc, setDoc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

// La marca de "tablet de planta" (marcarDispositivoProduccion /
// getDispositivoProduccion) se mudó a produccionDeviceService.ts (2026-09-14):
// Landing la necesita al arranque y no tiene por qué cargar este servicio.

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

// Resetea el PIN de un operario y devuelve el nuevo (4 dígitos) para que el
// encargado se lo comunique. Va por la Cloud Function `resetPinProduccion`
// porque cambiar la contraseña de OTRO usuario necesita el Admin SDK; la
// function valida que quien llama sea encargado/super_admin y que el target
// sea un operario de producción. El PIN no se guarda en ningún lado: si se
// pierde, se vuelve a resetear.
export async function resetPinProduccion(operarioUid: string): Promise<string> {
  // firebase/functions por import() dinámico: authService carga este módulo
  // para el login por legajo y no necesita el SDK de callables para eso.
  const { getFunctions, httpsCallable } = await import('firebase/functions')
  const call = httpsCallable<{ operarioUid: string }, { pin: string }>(
    getFunctions(),
    'resetPinProduccion',
  )
  const res = await call({ operarioUid })
  return res.data.pin
}
