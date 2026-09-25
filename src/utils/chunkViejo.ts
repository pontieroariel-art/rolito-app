// Chunk viejo después de un deploy (2026-09-22). Cada publicación reemplaza
// los archivos de la versión anterior en el hosting, y una pestaña que quedó
// abierta con la versión vieja falla al navegar a una pantalla que todavía no
// había bajado ("Failed to fetch dynamically imported module"). La salida es
// recargar: la pestaña toma el index.html nuevo con los chunks nuevos.
//
// Antes se recargaba UNA vez por sesión (sessionStorage 'chunk-reload'): con
// varios deploys en el mismo día, a partir del segundo la pestaña mostraba
// "Algo salió mal" cada vez (Ariel, 22/09 a la noche, con seis deploys). Ahora
// el freno es por tiempo: se recarga siempre que la última recarga por este
// motivo tenga más de 15 segundos, que es lo que corta un bucle (una recarga
// que vuelve a fallar al instante) sin castigar a la pestaña que sobrevivió a
// un deploy más.
//
// 2026-09-24 (Ariel: "este cartel me aparece bastante seguido"): recargar sin
// más no alcanzaba. El service worker sirve la navegación desde su precache
// (createHandlerBoundToURL('/index.html') en sw.ts), así que la recarga volvía
// a traer el index.html VIEJO mientras el SW nuevo todavía no había tomado el
// control, y el siguiente clic fallaba igual: dentro de los 15 s, cartel. Ahora,
// antes de recargar, se le pide al SW que busque la versión nueva y se espera a
// que tome el control (skipWaiting + clientsClaim en sw.ts), con un tope de 5 s
// por si no hay red o no hay SW; recién entonces la recarga trae el index nuevo.

const CLAVE = 'chunk-reload'
const MINIMO_ENTRE_RECARGAS_MS = 15_000
const TOPE_ESPERA_SW_MS = 5_000

export const esErrorDeChunkViejo = (error: { message?: string; name?: string } | null | undefined): boolean =>
  !!error && (
    (error.message ?? '').includes('Failed to fetch dynamically imported module')
    || (error.message ?? '').includes('Importing a module script failed')
    || (error.message ?? '').includes('error loading dynamically imported module')
    || error.name === 'ChunkLoadError'
  )

/** Recarga la pestaña si no se recargó por lo mismo hace menos de 15 s. Devuelve si va a recargar. */
export function recargarPorChunkViejo(): boolean {
  let ultima = 0
  try { ultima = Number(sessionStorage.getItem(CLAVE) ?? 0) } catch { /* sin storage */ }
  if (Date.now() - ultima < MINIMO_ENTRE_RECARGAS_MS) return false
  try { sessionStorage.setItem(CLAVE, String(Date.now())) } catch { /* sin storage */ }
  void actualizarSwYRecargar()
  return true
}

/** Pide el SW nuevo, espera (con tope) a que tome el control y recién ahí recarga. */
async function actualizarSwYRecargar(): Promise<void> {
  try {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
    const reg = sw ? await sw.getRegistration() : undefined
    if (sw && reg) {
      const tomoControl = new Promise<void>((resolve) => sw.addEventListener('controllerchange', () => resolve(), { once: true }))
      const tope = new Promise<void>((resolve) => setTimeout(resolve, TOPE_ESPERA_SW_MS))
      try { await reg.update() } catch { /* sin red: se recarga igual */ }
      if (reg.installing || reg.waiting) await Promise.race([tomoControl, tope])
    }
  } catch { /* sin SW o sin permiso: se recarga igual */ }
  window.location.reload()
}
