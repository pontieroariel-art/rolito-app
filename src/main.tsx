import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initObservability } from './services/observability'
import { recargarPorChunkViejo } from '@/utils/chunkViejo'

// Captura de errores en producción (gateada por VITE_SENTRY_DSN). Se inicializa
// lo antes posible para no perder errores tempranos de arranque.
initObservability()

// Un chunk que ya no existe en el hosting (deploy nuevo con la pestaña vieja
// abierta): Vite avisa acá antes de que el error llegue a React y se recarga.
// OJO: NO llamar a e.preventDefault() (versión 9b891b5, 22/09 23:51): con eso
// el import() resuelve undefined en vez de rechazar, React.lazy lee
// undefined.default y Sentry se llena de "Cannot read properties of undefined
// (reading 'default')" mientras la recarga todavía no llegó. Dejando pasar el
// error, el ErrorBoundary lo reconoce como chunk viejo y no vuelve a recargar
// (freno de 15 s).
window.addEventListener('vite:preloadError', () => { recargarPorChunkViejo() })

// ── Auto-actualización del PWA ────────────────────────────────────────────────
// Cuando el SW nuevo toma control (skipWaiting + clientsClaim en sw.ts),
// recargamos la página para que sirva los assets nuevos.
if ('serviceWorker' in navigator) {
  let reloading = false
  // hadController: ¿había un SW controlando antes de esta carga?
  // Si es false → primera instalación, no recargamos.
  // Si es true  → actualización, recargamos.
  let hadController = !!navigator.serviceWorker.controller

  // Con skipWaiting + clientsClaim el SW nuevo toma control apenas se
  // instala, es decir: cada push a master llega a todos los dispositivos
  // dentro de los 30 minutos. Recargar en ese instante tiraba a la basura el
  // remito que caja estaba cargando o la venta que el chofer estaba firmando.
  // Ahora se recarga recién cuando la app pasa a segundo plano (el usuario
  // cambió de app o bloqueó el teléfono), que es cuando no hay nada a medias.
  // Si antes de eso un chunk viejo falla al cargar, el ErrorBoundary ya
  // recarga una vez por su cuenta.
  const recargar = () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  }
  let recargaPendiente = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return }
    if (document.visibilityState === 'hidden') { recargar(); return }
    recargaPendiente = true
  })
  document.addEventListener('visibilitychange', () => {
    if (recargaPendiente && document.visibilityState === 'hidden') recargar()
  })

  // Verificar si hay un SW nuevo cada 30 minutos.
  // Crítico para sesiones largas (choferes con el celular encendido todo el día).
  let _swUpdateInterval: ReturnType<typeof setInterval> | null = null
  // `ready` nunca rechaza; `update()` sí (sin red): se calla y reintenta a los 30 min.
  void navigator.serviceWorker.ready.then((reg) => {
    if (_swUpdateInterval) return
    _swUpdateInterval = setInterval(() => { reg.update().catch(() => { /* sin red */ }) }, 30 * 60 * 1000)
  })
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
