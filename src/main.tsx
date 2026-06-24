import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// ── Auto-actualización del PWA ────────────────────────────────────────────────
// Cuando el SW nuevo toma control (skipWaiting + clientsClaim en sw.ts),
// recargamos la página para que sirva los assets nuevos.
if ('serviceWorker' in navigator) {
  let reloading = false
  // hadController: ¿había un SW controlando antes de esta carga?
  // Si es false → primera instalación, no recargamos.
  // Si es true  → actualización, recargamos.
  let hadController = !!navigator.serviceWorker.controller

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return }
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  // Verificar si hay un SW nuevo cada 30 minutos.
  // Crítico para sesiones largas (choferes con el celular encendido todo el día).
  let _swUpdateInterval: ReturnType<typeof setInterval> | null = null
  navigator.serviceWorker.ready.then((reg) => {
    if (_swUpdateInterval) return
    _swUpdateInterval = setInterval(() => reg.update(), 30 * 60 * 1000)
  })
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
