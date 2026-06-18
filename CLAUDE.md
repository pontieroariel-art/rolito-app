# CLAUDE.md

Este archivo provee contexto a Claude Code (claude.ai/code) para trabajar con este repositorio.

## Comandos

- **Servidor de desarrollo:** `npm run dev`
- **Build de producción:** `npm run build`
- **Preview del build:** `npm run preview`

No hay test runner ni linter configurados.

## Stack tecnológico

React 18 + TypeScript, Vite, Tailwind CSS 3, Firebase (Auth + Firestore + Hosting), React Router 6, Zustand, PWA via vite-plugin-pwa. Deploy en Firebase Hosting (`npx firebase deploy --only hosting`).

## Arquitectura

PWA para gestión de pedidos de distribución de hielo con tres roles de usuario:

- **cliente** — crear pedidos, ver historial, gestionar perfil (`/dashboard`, `/nuevo-pedido`, `/historial`, `/perfil`)
- **admin** — ver/gestionar todos los pedidos, asignar choferes, administrar lista de choferes (`/admin`)
- **chofer** — ver entregas asignadas del día, mapa de ruta con Google Maps (`/chofer`, `/chofer/map`)

### Determinación de roles

Los roles se resuelven en el login dentro de `AuthContext.tsx`, no se toman directamente de Firestore. El admin está hardcodeado por email. Los emails de choferes se almacenan en el documento `config/choferes` de Firestore. El resto son `cliente` por defecto.

### Directorios clave

- `src/services/` — Capa de interacción con Firebase (auth, CRUD de pedidos, perfiles, config de choferes)
- `src/hooks/` — Hooks que wrappean suscripciones a Firestore (`useOrders`, `useChoferes`, `useProfile`, `useGoogleMapsLoader`)
- `src/components/ui/` — Primitivos de UI reutilizables (Button, Input, Modal, Badge, LoadingSpinner)
- `src/components/layout/` — AuthLayout, Navbar, ProtectedRoute (guard de rutas por rol)
- `src/pages/` — Páginas organizadas por rol: `auth/`, `client/`, `admin/`, `chofer/`
- `src/utils/constants.ts` — Catálogo de productos, flujo de estados de pedido, labels

### Colecciones de Firestore

- `users/{uid}` — Perfiles de usuario
- `orders/{orderId}` — Pedidos (suscripciones en tiempo real via `onSnapshot`)
- `config/choferes` — `{ emails: string[] }` lista de emails de choferes

### Variables de entorno

Prefijo `VITE_FIREBASE_*`: `API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`. Además `VITE_GOOGLE_MAPS_KEY` para Google Maps.

### Optimización del build

Vite divide chunks manualmente: `firebase`, `maps` (Google Maps), `router` (React Router).

## Convenciones

- Se usa español para términos del dominio (pedido, chofer, cliente) y rutas
- Flujo de estados: `pendiente` → `confirmado` → `en_camino` → `entregado` (o `cancelado`)
- Reglas de seguridad de Firestore en `firestore.rules`
- Tema oscuro con paleta personalizada definida en `tailwind.config.js` (bg, accent, success, surface, border, muted)
- Fuente: Inter
