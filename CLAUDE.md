# CLAUDE.md

Este archivo provee contexto a Claude Code (claude.ai/code) para trabajar con este repositorio.

## Comandos

- **Servidor de desarrollo:** `npm run dev` — conecta a los emuladores locales de Firestore/Auth (no a producción), ver abajo
- **Build de producción:** `npm run build`
- **Preview del build:** `npm run preview`
- **Typecheck:** `npm run typecheck` (app) / `npm run typecheck:functions` (functions)
- **Lint:** `npm run lint`
- **Tests de reglas Firestore:** `npm run test:rules` (corre contra el emulador; requiere Java 21+)

No hay tests unitarios de UI; la cobertura automatizada está en las reglas de seguridad.

### Desarrollo local seguro (emuladores)

`npm run dev` conecta a los emuladores de Firestore/Auth en vez de a producción (`src/services/firebase.ts`, gateado por `import.meta.env.DEV` — no afecta el build de producción). Flujo (requiere Java 21+, igual que `test:rules`):

1. `npm run emulators` — levanta Firestore + Auth emulados (Emulator UI en `http://localhost:4000`; persiste datos entre reinicios en `emulator-data/`, gitignoreado)
2. `npm run seed:emulator` — carga datos mínimos de prueba (staff, choferes, cliente, camiones activos, pedidos) e imprime las credenciales; solo hace falta una vez por sesión de emulador
3. `npm run dev` — la app ya apunta al emulador

**Ojo:** las Cloud Functions (`sendPush`, `notifyCerca`, `notifyReprogramado`, `orsDirections`) no están emuladas — siguen pegándole a las funciones reales desplegadas. En la práctica, confirmar un despacho en local todavía manda una push real a un chofer real.

## Stack tecnológico

- **Frontend:** React 18 + TypeScript, Vite 6, Tailwind CSS 3, Radix UI, Lucide, React Router 6, Zustand, TanStack React Query 5, dnd-kit (tablero de despacho), Recharts, jsPDF/xlsx (exportes). PWA via `vite-plugin-pwa` con service worker propio (push + offline).
- **Backend (serverless):** Firebase — Auth, Firestore (tiempo real via `onSnapshot`), Cloud Functions (Node 22, TS, en `functions/`: emails con Resend, web push, pricing, rollups de gerencia, sync/outbox de Tango, turnos de ventanilla, triggers de heladeras, cleanup) y Hosting.
- **Mapas:** Google Maps (`@react-google-maps/api`): planificación de rutas, tracking del camión, autocomplete de direcciones.
- **Seguridad / observabilidad:** App Check (reCAPTCHA v3, `VITE_RECAPTCHA_SITE_KEY`) y Sentry (`@sentry/react`, gateado por `VITE_SENTRY_DSN` — ver `src/services/observability.ts`).

Deploy: push a `master` despliega automáticamente a Firebase Hosting via GitHub Actions.

## Arquitectura

PWA de gestión de una distribuidora de hielo, organizada en cuatro **sistemas/módulos** (`src/types.ts` → `Sistema`: `logistica`, `heladeras`, `produccion`, `expedicion`) con **16 roles** (`UserRole`). El techo de sistemas y el home por rol viven en `src/utils/sistemas.ts` (`ROLE_SISTEMAS`, `ROLE_HOME`); el picker de sistema está en `/sistema`. El mapa completo de rutas por rol está en `src/App.tsx`.

**Logística / pedidos** (el núcleo original):
- **cliente** — crear pedidos, historial, perfil, multi-sucursal (`/dashboard`, `/nuevo-pedido`, `/historial`, `/perfil`, `/sucursal`)
- **super_admin / logistica** — gestión de pedidos, despacho drag & drop, flota, visitas, incidencias, planificación (`/admin`, `/admin/*`, `/logistica`)
- **gerente_general** — tablero gerencial, monitoreo, reportes (`/gerente`, `/admin/monitoreo`)
- **gerente_comercial** — planificación, monitoreo, precios, reportes
- **comercial** — tablero comercial, pedidos, precios/catálogo, mapa live (`/comercial`, `/comercial/*`)
- **facturacion** — gestión de usuarios (código de cliente), reportes, movimientos (`/movimientos`)
- **chofer** (subrol opcional `ayudante`) — entregas del día, mapa de ruta, GPS (`/chofer`, `/chofer/map`); los choferes también registran cobranzas de cta. cte. en la calle (`/chofer/cobrar`) — no hay rol "cobrador" aparte

**Heladeras** (taller propio: fabricación y reacondicionamiento de heladeras/freezers; pipeline de pasos configurable en `config/pasosTaller`):
- **heladeras** — personal de taller (`/heladeras/*`)
- **heladeras_encargado** — encargado del módulo (+ `super_admin` y `gerente_comercial` con acceso completo)
- **tecnico** — técnico de calle, escanea el QR del equipo en el cliente

**Producción de hielo** (carga de pallets en planta Don Torcuato / Merlo desde tablet, con ticket Zebra):
- **produccion_hielo** — operario (subrol `maquinista`: parte de máquinas en vez de carga de pallets)
- **produccion_encargado** — encargado (resumen, listado, operarios, plantas)

**Expedición** (los camiones son depósitos móviles; circuito: remito de carga → entrega en muelle → salida por seguridad → venta en calle → descarga contada → liquidación). Roles fijos por `planta`:
- **caja** — remitos de carga, ventanilla, cobranzas de mostrador, liquidación de repartidores
- **muelle** — entrega la carga contra el remito y cuenta la descarga al volver el camión
- **seguridad** — control de salida en el portón

### Autenticación y roles

- El rol vive en `users/{uid}.rol` en Firestore y `AuthContext.tsx` lo observa en tiempo real (cambios de rol/estado impactan en sesiones activas).
- Logins separados por tipo de usuario (`src/services/authService.ts`); cada uno resuelve un índice en Firestore → email de Firebase Auth:
  - **clientes** por CUIT + contraseña (`/clientes` → `cuitIndex`)
  - **staff** por DNI + contraseña (`/empresa` → `staffDniIndex`) — incluye los roles de expedición (caja/muelle/seguridad) y el encargado de producción
  - **choferes** por DNI + PIN (`/choferes` → `dniIndex`)
  - **técnicos** por DNI + PIN (`/tecnicos` → `tecnicoDniIndex`)
  - **operarios de producción** por legajo + PIN (`/produccion-torcuato`, `/produccion-merlo` → `produccionLegajoIndex`; el PIN es individual, ver `produccionAuthService.ts`)
- Los clientes nuevos se registran con estado `pendiente` y deben ser aprobados.
- Algunas pantallas se fijan a un dispositivo por `localStorage` (tablet de planta → login por legajo; tablet de mostrador → solo Cobranzas) — ver `Landing.tsx` y los `*DeviceService`.

### Directorios clave

- `src/services/` — Capa de acceso a Firebase (un servicio por dominio: pedidos, despachos, flota, visitas, precios, ubicaciones, etc.)
- `src/hooks/` — Hooks que wrappean suscripciones a Firestore y React Query (`useOrders`, `useVisitas`, `useListasPrecios`, …)
- `src/components/ui/` — Primitivos de UI reutilizables
- `src/components/layout/` — AuthLayout, Navbar, ProtectedRoute (guard de rutas por rol)
- `src/components/admin/` — Piezas grandes del panel (DespachoBoard, MapaPlanificacion, VisitasPanel)
- `src/pages/` — Páginas por rol/módulo: `auth/`, `client/`, `admin/`, `chofer/`, `comercial/`, `gerente/`, `logistica/`, `shared/`, `produccion/`, `expedicion/`, `tecnico/`, `public/` (turnos de ventanilla, calculadora — sin login)
- `src/utils/constants.ts` — Catálogo de productos, flujo de estados de pedido, labels
- `functions/src/triggers/` — Triggers y callables (emails, push, pricing, `rollups`, `tangoSync`/`tangoOutbox`, `turnosVentanilla`, `heladeras`, `produccionAuth`, cleanup); todos se exportan en `functions/src/index.ts`
- `tests/firestore-rules.test.js` — Tests de las reglas de seguridad (node:test + emulador)

### Colecciones de Firestore principales

- `users/{uid}` — Perfiles (rol, estado, sucursales, código de cliente)
- `orders/{orderId}` — Pedidos
- `listas-precios`, `catalogo`, `historialPrecios` — Precios y catálogo
- `programas-visita`, `visitas-puntuales` — Visitas comerciales
- `despachos`, `asignacionesDia`, `flota` — Operación logística
- `ubicaciones/{driverEmail}` — Posición GPS de choferes en tiempo real
- `config/*`, `configuracion/*` — Configuración (zonas, horarios, etc.)
- `cuitIndex`, `dniIndex`, `staffDniIndex`, `tecnicoDniIndex`, `produccionLegajoIndex` — Índices de login (`get` público para resolver el login, `list` cerrado a staff — ver auditoría en `firestore.rules`)
- `pedidos-recurrentes/{clientId}` — Pedidos recurrentes
- `rollupsPedidos/{YYYY-MM-DD}` — Agregados diarios de pedidos que escribe el trigger `onOrderRollup`; los KPIs de gerencia leen esto y no dependen del stream de pedidos (que está topeado)

Por módulo:
- **Heladeras:** `heladeras`, `ticketsServicio`, `asignacionesHeladera`, `modelosHeladera`, `config/pasosTaller`, `config/motivosReparacion`
- **Producción:** `produccionPallets`, `partesMaquinas`, `config/produccionCounter_{planta}`
- **Expedición:** `remitosCarga`, `ventasCamion`, `ventasVentanilla`, `cobranzas`, `cambiosCamion`, `descargasCamion`, `liquidaciones`, `turnosPublicos` (doc público sanitizado que lee la página del QR con sesión anónima), `config/turnoVentanilla_{planta}`, `config/cargaCounter_{planta}`

### Variables de entorno

Prefijo `VITE_FIREBASE_*`: `API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`. Además `VITE_GOOGLE_MAPS_API_KEY` (Google Maps), `VITE_VAPID_PUBLIC_KEY` (web push), `VITE_RECAPTCHA_SITE_KEY` (App Check, reCAPTCHA v3) y `VITE_SENTRY_DSN` (Sentry — opcional; la observabilidad se activa solo si está presente). En CI, todas se inyectan como GitHub Secrets en `deploy.yml`. Los secretos de Cloud Functions (`RESEND_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `ORS_KEY` para OpenRouteService, `TANGO_BRIDGE_SECRET` para el bridge de Tango) se configuran con `firebase functions:secrets:set`, no en `.env`.

### CI (GitHub Actions)

- `ci.yml` — typecheck (app + functions), ESLint y tests de reglas contra el emulador (instala Java 21, requerido por firebase-tools).
- `deploy.yml` — deploy a Firebase Hosting en cada push a `master`.

### Deploy manual (reglas y functions)

Solo el **hosting** se despliega solo (push a `master`). Reglas y functions van a mano:

- **Reglas:** `firebase deploy --only firestore:rules` (correr `npm run test:rules` antes). Índices: `--only firestore:indexes`.
- **Functions — OJO, footgun:** `functions/lib/` (el JS compilado) está **commiteado al repo** y `firebase.json` **NO** tiene hook `predeploy`. Si editás `functions/src/*.ts` y corrés `firebase deploy --only functions` sin compilar antes, se sube el JS viejo (o tira "No function matches the filter" para triggers nuevos). Siempre: `npm --prefix functions run build` → verificar que `lib/` refleje el cambio → deployar → **commitear el `lib/` regenerado**. Si son muchas functions, deployar de a ≤6-8 (`--only functions:a,functions:b,...`) por la cuota de Cloud Run.

### Optimización del build

Vite divide chunks manualmente: `firebase`, `maps` (Google Maps), `router` (React Router).

## Convenciones

- Se usa español para términos del dominio (pedido, chofer, despacho, visita) y rutas
- Flujo de estados: `pendiente` → `confirmado` → `en_camino` → `entregado` (o `cancelado`)
- Reglas de seguridad de Firestore en `firestore.rules` — la autorización real vive ahí; la UI solo oculta opciones. Todo cambio de permisos debe tocar reglas + tests
- **Tema visual:** la app se ve **clara/cálida** — fondo `#F8F7F2`, cards blancas, bordes `#D3D1C7`, acento verde `#1D9E75`, texto `text-gray-*`. Ojo: la mayoría de las pantallas usan estos colores **hardcodeados** (valores arbitrarios de Tailwind tipo `bg-[#F8F7F2]`), no los tokens `bg`/`surface`/`border` de `tailwind.config.js`, que quedaron con la **paleta oscura vieja** (pre-rediseño cálido de 2026-06). Solo el acento (`accent`/`success` = `#1D9E75`) coincide entre ambos. Al hacer una pantalla nueva, seguí el patrón claro hardcodeado de las pantallas existentes, no los tokens oscuros.
- Fuente: Inter
- **Streams de colección entera** (heladeras, pedidos, tickets, modelos): usar `useSharedSubscription` (`src/hooks/useSharedSubscription.ts`) con una key por colección — una sola suscripción compartida entre todos los componentes montados, con keep-alive al cambiar de pantalla. `useFirestoreSubscription` queda para streams acotados (por usuario, por día). En dev loguea `[sub] <key>: N docs` en la consola para ver cuánto baja cada pantalla
- ESLint debe quedar en 0 warnings (`react-hooks/exhaustive-deps` se resuelve o se documenta con disable puntual comentado)
- Preferir el alias `@/` (`@/components`, `@/hooks`, `@/services`) en imports nuevos en vez de rutas relativas de 2+ niveles (`../../..`). No hace falta migrar imports existentes
