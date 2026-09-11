import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'

// Sesión "Ver como" del super_admin (2026-09-10): el custom token que emite
// crearTokenImpersonacion trae el claim `impersonadoPor`. Esa sesión es de
// SOLO LECTURA: las reglas de Firestore ya rechazan sus escrituras, y esto
// cierra la otra puerta — las callables, que escriben con el Admin SDK y
// resuelven el rol por el uid del token (que es el de la persona observada).
export function esImpersonado(request: CallableRequest<unknown>): boolean {
  return typeof request.auth?.token?.impersonadoPor === 'string'
}

export function assertNoImpersonado(request: CallableRequest<unknown>): void {
  if (esImpersonado(request)) {
    throw new HttpsError('permission-denied', 'Sesión de solo lectura (Ver como): esta acción no está disponible')
  }
}
