import { FirebaseError } from 'firebase/app'

/**
 * Mensaje para el operario cuando falla el ingreso por legajo y PIN. Lo usan
 * la pantalla de ingreso de la planta y el "Cambiar operario" de la tablet de
 * carga (2026-09-25). Devuelve `inesperado: true` cuando hay que reportarlo.
 */
export function mensajeErrorLoginProduccion(err: unknown): { mensaje: string; inesperado: boolean } {
  if (err instanceof Error && err.message === 'legajo-not-found') return { mensaje: 'Legajo no encontrado', inesperado: false }
  if (err instanceof FirebaseError) {
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(err.code)) {
      return { mensaje: 'Legajo o PIN incorrecto', inesperado: false }
    }
    if (err.code === 'auth/network-request-failed') return { mensaje: 'Sin conexión. Revisá la señal e intentá de nuevo.', inesperado: false }
    if (err.code === 'auth/too-many-requests') return { mensaje: 'Demasiados intentos. Esperá unos minutos.', inesperado: false }
    return { mensaje: `Error al ingresar (${err.code})`, inesperado: true }
  }
  return { mensaje: 'Error al ingresar. Verificá el legajo.', inesperado: true }
}
