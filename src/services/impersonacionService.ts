import { getFunctions, httpsCallable } from 'firebase/functions'
import { signInWithCustomToken, signOut } from 'firebase/auth'
import { auth, SESION_VER_COMO } from './firebase'

// "Ver como usuario" (2026-09-10): el super_admin abre la app con la sesión
// real de otra persona, en otra pestaña y en solo lectura. El server
// (crearTokenImpersonacion) valida, audita y emite un custom token con el
// claim `impersonadoPor`; esta pestaña lo canjea con signInWithCustomToken.
// Las reglas de Firestore y las callables rechazan toda escritura de esa
// sesión; el front además frena GPS/push y muestra el banner.

export interface VistaComoAbierta {
  nombre:  string
  rol:     string
  /** URL de la pestaña. Si el navegador bloqueó el popup, mostrarla como link. */
  url:     string
  abierta: boolean
}

interface RespuestaToken { token: string; nombre: string; rol: string }

export const esSesionVerComo = (): boolean => SESION_VER_COMO !== null

/** Pide el token al server y abre la pestaña "Ver como". Lanza si el server rechaza. */
export async function abrirVistaComo(uid: string): Promise<VistaComoAbierta> {
  const fn = httpsCallable<{ uid: string }, RespuestaToken>(getFunctions(), 'crearTokenImpersonacion')
  let data: RespuestaToken
  try {
    data = (await fn({ uid })).data
  } catch (err) {
    // Los HttpsError del server ya vienen con texto en español; 'internal' es
    // que la function no está desplegada o falló (en local nunca lo está).
    const e = err as { code?: string; message?: string }
    if (e?.code === 'functions/internal' || e?.message === 'internal') {
      throw new Error('No se pudo abrir la vista: la función del servidor no respondió (¿está desplegada?)')
    }
    throw err
  }
  const url = `${window.location.origin}/#ver-como=${encodeURIComponent(data.token)}`
  // Sin 'noopener': la pestaña tiene que poder cerrarse sola (window.close()
  // solo funciona en ventanas abiertas por script).
  const win = window.open(url, '_blank')
  return { nombre: data.nombre, rol: data.rol, url, abierta: !!win }
}

/** En la pestaña "Ver como": canjea el token guardado. Falla si venció (>1 h) o fue revocado. */
export async function iniciarSesionVerComo(): Promise<void> {
  if (!SESION_VER_COMO) return
  await signInWithCustomToken(auth, SESION_VER_COMO.token)
}

/** Termina la vista: cierra la pestaña; si el navegador no lo permite, cierra la sesión. */
export async function cerrarVistaComo(): Promise<void> {
  try { window.sessionStorage.removeItem('rolito.verComo') } catch { /* sin storage */ }
  window.close()
  await new Promise((r) => setTimeout(r, 250))
  if (!window.closed) await signOut(auth)
}
