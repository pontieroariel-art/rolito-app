# CLAUDE.md

Este archivo provee contexto a Claude Code (claude.ai/code) para trabajar con este repositorio.

## Comandos

- **Servidor de desarrollo:** `npm run dev`
- **Build de producción:** `npm run build`
- **Preview del build:** `npm run preview`
- **Typecheck:** `npm run typecheck` (app) / `npm run typecheck:functions` (functions)
- **Lint:** `npm run lint`
- **Tests de reglas Firestore:** `npm run test:rules` (corre contra el emulador; requiere Java 21+)

No hay tests unitarios de UI; la cobertura automatizada está en las reglas de seguridad.

## Stack tecnológico

- **Frontend:** React 18 + TypeScript, Vite 6, Tailwind CSS 3, Radix UI, Lucide, React Router 6, Zustand, TanStack React Query 5, dnd-kit (tablero de despacho), Recharts, jsPDF/xlsx (exportes). PWA via `vite-plugin-pwa` con service worker propio (push + offline).
- **Backend (serverless):** Firebase — Auth, Firestore (tiempo real via `onSnapshot`), Cloud Functions (Node 22, TS, en `functions/`: emails con Resend, web push, pricing, cleanup) y Hosting.
- **Mapas:** Google Maps (`@react-google-maps/api`): planificación de rutas, tracking del camión, autocomplete de direcciones.

Deploy: push a `master` despliega automáticamente a Firebase Hosting via GitHub Actions.

## Arquitectura

PWA de gestión de pedidos para una distribuidora de hielo. Ocho roles (`src/types.ts` → `UserRole`):

- **cliente** — crear pedidos, historial, perfil, multi-sucursal (`/dashboard`, `/nuevo-pedido`, `/historial`, `/perfil`, `/sucursal`)
- **super_admin / logistica** — gestión de pedidos, despacho drag & drop, flota, visitas, incidencias, planificación (`/admin`, `/admin/*`, `/logistica`)
- **gerente_general** — tablero gerencial, monitoreo, reportes (`/gerente`, `/admin/monitoreo`)
- **gerente_comercial** — planificación, monitoreo, precios, reportes
- **comercial** — tablero comercial, pedidos, precios/catálogo, mapa live (`/comercial`, `/comercial/*`)
- **facturacion** — gestión de usuarios (código de cliente), reportes, movimientos
- **chofer** (subrol opcional `ayudante`) — entregas del día, mapa de ruta, envío de GPS (`/chofer`, `/chofer/map`)

El mapa completo de rutas por rol está en `src/App.tsx`.

### Autenticación y roles

- El rol vive en `users/{uid}.rol` en Firestore y `AuthContext.tsx` lo observa en tiempo real (cambios de rol/estado impactan en sesiones activas).
- Logins separados: clientes por CUIT (`/clientes`), staff por usuario (`/empresa`), choferes por DNI+PIN (`/choferes`). Detrás usan índices en Firestore (`cuitIndex`, `staffIndex`, `choferIndex`, `dniIndex`, `staffDniIndex`) que mapean a emails de Firebase Auth.
- Los clientes nuevos se registran con estado `pendiente` y deben ser aprobados.

### Directorios clave

- `src/services/` — Capa de acceso a Firebase (un servicio por dominio: pedidos, despachos, flota, visitas, precios, ubicaciones, etc.)
- `src/hooks/` — Hooks que wrappean suscripciones a Firestore y React Query (`useOrders`, `useVisitas`, `useListasPrecios`, …)
- `src/components/ui/` — Primitivos de UI reutilizables
- `src/components/layout/` — AuthLayout, Navbar, ProtectedRoute (guard de rutas por rol)
- `src/components/admin/` — Piezas grandes del panel (DespachoBoard, MapaPlanificacion, VisitasPanel)
- `src/pages/` — Páginas por rol: `auth/`, `client/`, `admin/`, `chofer/`, `comercial/`, `gerente/`, `shared/`
- `src/utils/constants.ts` — Catálogo de productos, flujo de estados de pedido, labels
- `functions/src/triggers/` — Triggers de Firestore (emails, push, pricing, cleanup)
- `tests/firestore-rules.test.js` — Tests de las reglas de seguridad (node:test + emulador)

### Colecciones de Firestore principales

- `users/{uid}` — Perfiles (rol, estado, sucursales, código de cliente)
- `orders/{orderId}` — Pedidos
- `listas-precios`, `catalogo`, `historialPrecios` — Precios y catálogo
- `programas-visita`, `visitas-puntuales` — Visitas comerciales
- `despachos`, `asignacionesDia`, `flota` — Operación logística
- `ubicaciones/{driverEmail}` — Posición GPS de choferes en tiempo real
- `config/*`, `configuracion/*` — Configuración (zonas, horarios, etc.)
- `cuitIndex`, `choferIndex`, `staffIndex`, `dniIndex`, `staffDniIndex` — Índices de login
- `pedidos-recurrentes/{clientId}` — Pedidos recurrentes

### Variables de entorno

Prefijo `VITE_FIREBASE_*`: `API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`. Además `VITE_GOOGLE_MAPS_API_KEY` (Google Maps) y `VITE_VAPID_PUBLIC_KEY` (web push). Los secretos de Cloud Functions (`RESEND_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `ORS_KEY` para OpenRouteService) se configuran con `firebase functions:secrets:set`, no en `.env`.

### CI (GitHub Actions)

- `ci.yml` — typecheck (app + functions), ESLint y tests de reglas contra el emulador (instala Java 21, requerido por firebase-tools).
- `deploy.yml` — deploy a Firebase Hosting en cada push a `master`.

### Optimización del build

Vite divide chunks manualmente: `firebase`, `maps` (Google Maps), `router` (React Router).

## Convenciones

- Se usa español para términos del dominio (pedido, chofer, despacho, visita) y rutas
- Flujo de estados: `pendiente` → `confirmado` → `en_camino` → `entregado` (o `cancelado`)
- Reglas de seguridad de Firestore en `firestore.rules` — la autorización real vive ahí; la UI solo oculta opciones. Todo cambio de permisos debe tocar reglas + tests
- Tema oscuro con paleta personalizada definida en `tailwind.config.js` (bg, accent, success, surface, border, muted)
- Fuente: Inter
- ESLint debe quedar en 0 warnings (`react-hooks/exhaustive-deps` se resuelve o se documenta con disable puntual comentado)
