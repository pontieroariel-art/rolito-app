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

// SHA corto del commit del build (ver vite.config.ts). Se muestra en la
// pantalla de error para que soporte sepa qué versión tiene el usuario.
export const APP_RELEASE: string = typeof __APP_RELEASE__ === 'string' ? __APP_RELEASE__ : 'local'

export function initObservability(): void {
  if (!dsn || import.meta.env.DEV) return
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Qué build tiró el error. Sin esto no se distingue "bug nuevo" de "bug
    // ya arreglado que sigue apareciendo desde una pestaña vieja".
    release: `rolito-app@${APP_RELEASE}`,
    // Ruido conocido del navegador que no es un error de la app.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
    ],
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

// Envuelve un write fire-and-forget (offline-first) para que un rechazo del
// servidor —una regla que lo niega, un revert— deje de ser invisible. NO
// bloquea ni cambia el comportamiento offline: sin red la promesa queda
// pendiente y el write se encola local igual; pero si el servidor lo rechaza,
// en vez de morir en silencio (la UI ya dijo "registrado") queda reportado.
// Ver auditoría 2026-08-29: ventas/cobranzas que podían perderse sin aviso.
export function fireAndForget(op: Promise<unknown>, context?: Record<string, unknown>): void {
  op.catch((err) => reportError(err, { fireAndForget: true, ...context }))
}

// Handler de error para onSnapshot que reporta en vez de tragar en silencio.
// Sigue entregando lista vacía al callback (no rompe la UI), pero el error
// queda visible en vez de confundirse con "no hay datos" — clave en las
// pantallas de plata (una liquidación mostrada en $0 por un error de lectura
// no debe parecer un día sin ventas). Ver auditoría 2026-08-29. FirestoreError
// extiende Error, así que este handler encaja donde onSnapshot lo espera.
// `alFallar` es opcional y sirve para que la pantalla pueda decir la verdad.
// Sin él, un índice que falta se ve idéntico a "no hay nada": eso fue
// exactamente lo que pasó con las facturas del chofer el 2026-09-02, con una
// factura ya emitida y la pantalla diciendo "todavía no cargaste ninguna
// venta". Reportar a Sentry no alcanza cuando el que mira es el usuario.
export function onSnapshotError<T>(
  callback: (items: T[]) => void,
  origen: string,
  alFallar?: (err: Error) => void,
): (err: Error) => void {
  return (err) => {
    reportError(err, { subscription: origen })
    callback([])
    alFallar?.(err)
  }
}

// Espera la confirmación del servidor hasta `ms`. Si no llega (sin señal, red
// muy lenta), resuelve 'encolado' y la pantalla puede seguir: el write ya está
// persistido en el cache local de Firestore y se sube solo al reconectar. Un
// rechazo del servidor (regla, revert) que llegue después queda reportado por
// fireAndForget; uno que llegue antes del timeout rechaza acá y la pantalla
// muestra el error. Sin esto, un `await updateDoc()` sin señal no resuelve
// NUNCA y el chofer queda mirando un spinner con la entrega ya registrada.
export function esperarOEncolar(
  op: Promise<unknown>,
  context?: Record<string, unknown>,
  ms = 4000,
): Promise<'confirmado' | 'encolado'> {
  fireAndForget(op, context)
  return Promise.race([
    op.then(() => 'confirmado' as const),
    new Promise<'encolado'>((resolve) => setTimeout(() => resolve('encolado'), ms)),
  ])
}
