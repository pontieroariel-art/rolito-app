import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { StaleWhileRevalidate, CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare let self: ServiceWorkerGlobalScope

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Fallback de navegación: si el chofer/técnico abre una ruta profunda
// (/admin/despacho, /heladeras/panol, ...) sin señal, servir el app-shell
// precacheado en vez de dejar la pantalla en blanco. React Router toma el
// control del lado del cliente una vez que el shell cargó.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

// Chunks pesados de uso puntual (excluidos del precache, ver vite.config.ts):
// se cachean recién la primera vez que el usuario realmente los pide
// (abrir Pañol, exportar a Excel, importar un PDF, ver un reporte), y de ahí
// en adelante quedan disponibles offline sin haber competido por ancho de
// banda durante el install del service worker.
registerRoute(
  ({ url }) => /\/(xlsx|pdfjs|pdf-|PanolPage|charts|html2canvas|BarcodeScanner)[\w.-]*\.js$/.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: 'rolito-heavy-chunks',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
)

// Imágenes propias (logo, íconos, marcadores de mapa)
registerRoute(
  ({ request, url }) => request.destination === 'image' && url.origin === self.location.origin,
  new CacheFirst({
    cacheName: 'rolito-images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
)

self.addEventListener('push', (event) => {
  if (!event.data) return
  const { title, body } = event.data.json() as { title: string; body: string }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    }),
  )
})
