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

const CLAVE = 'chunk-reload'
const MINIMO_ENTRE_RECARGAS_MS = 15_000

export const esErrorDeChunkViejo = (error: { message?: string; name?: string } | null | undefined): boolean =>
  !!error && (
    (error.message ?? '').includes('Failed to fetch dynamically imported module')
    || (error.message ?? '').includes('Importing a module script failed')
    || (error.message ?? '').includes('error loading dynamically imported module')
    || error.name === 'ChunkLoadError'
  )

/** Recarga la pestaña si no se recargó por lo mismo hace menos de 15 s. Devuelve si recargó. */
export function recargarPorChunkViejo(): boolean {
  let ultima = 0
  try { ultima = Number(sessionStorage.getItem(CLAVE) ?? 0) } catch { /* sin storage */ }
  if (Date.now() - ultima < MINIMO_ENTRE_RECARGAS_MS) return false
  try { sessionStorage.setItem(CLAVE, String(Date.now())) } catch { /* sin storage */ }
  window.location.reload()
  return true
}
