# Despliegue

## Vercel

La app está configurada para desplegarse en Vercel.

### Configuración

El archivo `vercel.json` define un rewrite para SPA:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Esto redirige todas las rutas a `index.html` para que React Router maneje la navegación.

### Variables de entorno en Vercel

Configurar en **Settings → Environment Variables** del proyecto en Vercel:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_GOOGLE_MAPS_KEY
```

### Build

Vercel detecta automáticamente Vite. El comando de build es `npm run build` y la carpeta de salida es `dist/`.

## Build local

```bash
npm run build     # Genera la carpeta dist/
npm run preview   # Sirve dist/ en un servidor local para verificar
```

### Chunks optimizados

El build divide el código en chunks separados para mejor caching:

| Chunk | Contenido |
|-------|-----------|
| `firebase` | firebase/app, firebase/auth, firebase/firestore |
| `maps` | @react-google-maps/api |
| `router` | react-router-dom |

Configurado en `vite.config.ts` con `manualChunks`. Límite de warning: 600KB.

## PWA

La app se instala como PWA gracias a `vite-plugin-pwa`:

- El service worker se genera automáticamente en el build
- Se actualiza automáticamente (`registerType: 'autoUpdate'`)
- Iconos en `public/icons/` (SVG 192x192 y 512x512)
- Display: standalone (sin barra del navegador)
- Color del tema: `#0A1628`
