import * as Sentry from '@sentry/react'

// Observabilidad de errores en producción. Gateada por VITE_SENTRY_DSN, igual
// que App Check por su key: sin DSN no inicializa nada (ni en dev, ni en un
// build sin la variable), así que no afecta el desarrollo local ni pesa de más.
// Con DSN, Sentry captura las excepciones no atrapadas —el render de React (vía
// el ErrorBoundary), las promesas rechazadas y los errores globales— para que
// una venta o una liquidación que falla deje de ser invisible hasta que un
// chofer o un cliente se queja. Ver auditoría 2026-08-29 (hallazgo de
// observabilidad).
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined

let activo = false

export function initObservability(): void {
  if (!dsn || import.meta.env.DEV) return
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Foco en monitoreo de errores. Sin PII por defecto (no manda cookies,
    // headers ni cuerpos); sin session replay (privacidad + peso). Se puede
    // sumar tracing/replay a conciencia más adelante.
    sendDefaultPii: false,
  })
  activo = true
}

// Asocia (o limpia) el usuario logueado con los reportes, sin datos sensibles:
// solo uid y rol, para poder rastrear a qué operario/rol le pasó el error.
export function setObservabilityUser(user: { uid: string; rol?: string } | null): void {
  if (!activo) return
  Sentry.setUser(user ? { id: user.uid, rol: user.rol } : null)
}

// Reporta un error ya manejado (un catch que no queremos que pase en silencio).
// Siempre loguea a consola —útil en dev y como respaldo—; manda a Sentry solo
// si está activo.
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  console.error('[observability]', error, context ?? '')
  if (!activo) return
  Sentry.captureException(error, context ? { extra: context } : undefined)
}
