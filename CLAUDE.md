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

PWA de gestión de una distribuidora de hielo, organizada en cuatro **sistemas/módulos** (`src/types.ts` → `Sistema`: `logistica`, `heladeras`, `produccion`, `expedicion`) con **17 roles** (`UserRole`). El techo de sistemas y el home por rol viven en `src/utils/sistemas.ts` (`ROLE_SISTEMAS`, `ROLE_HOME`); el picker de sistema está en `/sistema`. El mapa completo de rutas por rol está en `src/App.tsx`.

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
- **supervisor** (de cobranzas, ver Expedición) — desde la ficha del cliente (`/supervisor/cliente/:uid`) o el QR (`/heladeras/ficha/:id`) pide service con foto (`ticketsServicio.origen = 'supervisor'`, foto en Storage `ticketsServicio/{id}/foto.jpg`, el trigger avisa al encargado) y firma renovaciones de comodato en el celular (`renovarComodato`, contrato compartido por WhatsApp). Solo lectura de `heladeras`; las reglas acotan cada escritura

**Producción de hielo** (carga de pallets en planta Don Torcuato / Merlo desde tablet, con ticket Zebra):
- **produccion_hielo** — operario (subrol `maquinista`: parte de máquinas en vez de carga de pallets)
- **produccion_encargado** — encargado (resumen, listado, operarios, plantas)

**Expedición** (los camiones son depósitos móviles; circuito: remito de carga → entrega en muelle → salida por seguridad → venta en calle → descarga contada → liquidación). Roles fijos por `planta`:
- **caja** — remitos de carga, ventanilla, cobranzas de mostrador, liquidación de repartidores
- **muelle** — entrega la carga contra el remito y cuenta la descarga al volver el camión
- **seguridad** — control de salida en el portón
- **tesoreria** (2026-09-09, rol propio, NO es facturación) — panel `/tesoreria` (`TesoreriaLayout`): tablero en vivo de calle por chofer, ventanillas por cajero y supervisores (`utils/tesoreriaLive.ts`), validación de las rendiciones y su historial, liquidaciones de repartidores en modo lectura (`/tesoreria/liquidaciones`), confirmación de las entregas de caja (`/tesoreria/entregas`) y tile "Tiene que llegarme" (`utils/entregaTesoreria.esperadoTesoreria`); en el bloque Supervisores cada fila se expande con sus recibos (`CobranzaSupervisorCard`). `gerente_general` entra en modo lectura
- **Rendiciones / cierre de caja por persona y día** (2026-09-09): cada usuario de caja cierra SU caja (`/caja/rendiciones`, "Mi caja"): ventas, cobranzas de mostrador, valores en papel, bultos y el efectivo recibido al cerrar liquidaciones de repartidores → efectivo a rendir vs contado, diferencia con motivo, firma, PDF (`utils/rendicionPdf.ts`). Colección `rendiciones` (id `{fecha}_{uid}`, código `RD-DT-000012` con `config/rendicionCounter_{planta}`), inmutable salvo `validacion` (tesorería) y `entregaId` (entrega a tesorería, pendiente). Cálculo puro en `utils/rendicionMostrador.ts`; medios de una cobranza en `utils/medios.ts`. La ventanilla muestra "Mi día" del cajero. Ventanilla sigue vendiendo desde el depósito de la planta (01/02)
- **Liquidación del repartidor numerada, con doble firma y valores tildados** (2026-09-09): `liquidaciones` lleva `numero`/`codigo` `LQ-<depósito Tango>-000015` por persona (`config/liquidacionCounter_{serie}`, `utils/liquidacion.serieLiquidacion`; sin depósito: serie por uid con prefijo `SD`), firma del repartidor y **firma de quien recibe** (`firmaRecibe`/`firmanteRecibe`), y `cheques`/`retenciones` con `recibido` + `motivoNoEntregado` tildados uno por uno en el modal (`utils/valoresEnPapel.ts`, `components/expedicion/ValoresEnPapel.tsx`; uno sin decidir bloquea el cierre; `valoresFaltantes`). El cierre es transaccional (`cerrarLiquidacion`, `LiquidacionYaCerradaError`). El chofer y el supervisor ven "Mi rendición" en su home (`components/chofer/MiRendicionCard.tsx`, lectura por id `{fecha}_{uid}`). El cierre de caja de ventanilla también tilda sus valores (sin segunda firma: la valida tesorería)
- **Entrega de caja a tesorería** (2026-09-09): `/caja/entregas` junta lo pendiente de la planta (liquidaciones + cierres con `entregaId === null`, últimos 7 días), deduplica el efectivo (el cierre de caja YA incluye las liquidaciones que ese cajero cerró: `rendicion.liquidacionesIds`), caja declara el efectivo, firma y sale el acta (`utils/entregaPdf.ts`). Colección `entregasTesoreria` (id `{fecha}_{planta}_{numero}`, código `ET-DT-000045`, `config/entregaCounter_{planta}`); la transacción (`services/entregaTesoreriaService.crearEntrega`) marca `entregaId` en cada doc incluido. Tesorería confirma en `/tesoreria/entregas` (cuenta, tilda cada valor, firma → `estado: 'confirmada'`, una sola vez). Lógica pura y tests en `utils/entregaTesoreria.ts`
- **Anulación de facturas de ventanilla con nota de crédito** (2026-09-09): el cajero pide desde Ventanilla ("Anular factura", solo sobre SU venta facturada por ARCA y mientras su caja del día no esté cerrada) → `anulacionesVentanilla/{ventaId}` (una por venta; `estado` pendiente → aprobada|rechazada → emitida|error). Autoriza quien tiene el **permiso individual `users.autorizaAnulaciones`** (cualquier rol; lo da solo el super_admin desde Usuarios) o super_admin, nunca el propio solicitante, desde la bandeja `/anulaciones` (Navbar/logisticaNav, filtrada por el permiso) o `/tesoreria/anulaciones`; la push (`url` en el payload, `sw.ts` la abre) avisa a los autorizantes y al cajero. El server (`functions/src/triggers/anulacionesVentanilla.ts` → `services/arca/anulacionVentanilla.ts` + `notaCredito.ts`) emite la **NC total** en ARCA (misma clase, `CbtesAsoc`, importes idénticos: copia el `detalle` guardado en `facturasArca` o lo reconstruye desde `importes`; contadores `config/arcaNumeracion_1104_{3|8|13}` sembrados con `scripts/arca/sembrar-numeracion.mjs`), la registra en `facturasArca/nc_{ventaId}` (reconciliación horaria compartida) y refleja `ventasVentanilla.anulacion` (`anulada` con `notaCredito`). Solo anulación total. Una venta `anulada` no cuenta en Mi día, cierre de caja (`utils/rendicionMostrador.ts`) ni tesorería (`utils/tesoreriaLive.ts`); una pendiente bloquea el cierre. PDF/ticket de la NC: `utils/facturaDeVenta.armarNotaCreditoDeVenta` (título y comprobante asociado en `facturaArcaPdf.ts` / `ventanillaTicket.ts`). La NC viaja a Tango por el Facturador como `CDE` con referencia a la factura (`onAnulacionEmitida` → outbox `notaCredito` → `enviarNotaCredito`; talonarios propios en `config/tango.facturador.redonhielo.talonariosNC`; docs/tango §33) y devuelve el stock al depósito
- **Quién vendió en Tango** (2026-09-09): el **vendedor** de todo comprobante que manda la app es el **supervisor del cliente** (`COD_VENDED` de su ficha; antes iba el chofer y pisaba el filtro por supervisor de la oficina); quién vendió/cobró (cajero, chofer, supervisor) va en una leyenda y en el campo USUARIO de los comprobantes por SQL (`sql/comun.ts` → `leyendaQuienVende`, `usuarioCorto`)
- **Envases retornables** (2026-09-07): el remito de carga lleva `envases` (tarimas de madera, pallets de metal, números de rack de agua; puntales y aros implícitos 4 y 1 por pallet) que caja declara al emitir; la descarga lleva `envases` contados sueltos por muelle (reemplaza a completos/parciales/vacíos, que quedan como legacy); la liquidación cuadra por tipo y racks por número. Toda la lógica pura y la compat con docs viejos en `src/utils/envases.ts`. Tango no los recibe todavía (viajan en el payload de la cola)

### Autenticación y roles

- El rol vive en `users/{uid}.rol` en Firestore y `AuthContext.tsx` lo observa en tiempo real (cambios de rol/estado impactan en sesiones activas).
- Logins separados por tipo de usuario (`src/services/authService.ts`); cada uno resuelve un índice en Firestore → email de Firebase Auth:
  - **clientes** por CUIT + contraseña (`/clientes` → `cuitIndex`)
  - **staff** por DNI + contraseña (`/empresa` → `staffDniIndex`) — incluye los roles de expedición (caja/muelle/seguridad) y el encargado de producción
  - **choferes** por DNI + PIN (`/choferes` → `dniIndex`)
  - **técnicos** por DNI + PIN (`/tecnicos` → `tecnicoDniIndex`)
  - **operarios de producción** por legajo + PIN (`/produccion-torcuato`, `/produccion-merlo` → `produccionLegajoIndex`; el PIN es individual, ver `produccionAuthService.ts`)
- Los clientes nuevos se registran con estado `pendiente` y deben ser aprobados.
- **Roles adicionales** (`users.rolesExtra`, solo `caja`/`muelle`/`seguridad`, con `planta`): para staff que cubre el mostrador además de su puesto (ej. logística + caja). Las reglas preguntan `hasRol()` para esos tres roles; en el front todo pasa por `tieneRol`/`tieneAlgunRol` (`src/utils/roles.ts`), nunca por `user.rol === 'caja'`. Los asigna el super_admin desde Usuarios ("También hace").
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
- `clientesIndex/{uid}` — Índice liviano de clientes para BUSCAR (2026-09-10: razón social, CUIT, códigos de Tango, sucursales, dirección, localidad, estado, vinculadoTango). Lo mantiene el trigger `onClienteIndexado` (solo escribe si cambió algo de eso; la sync de precios no lo toca) y lo cargó `scripts/backfill-clientes-index.mjs`. Los buscadores (`useClientesIndex` + `indexAComboItems`: venta y cobro del chofer, Buscar cliente del supervisor) leen esto desde la caché del teléfono y piden la ficha completa por id al elegir (`useClienteSeleccionado`). `useClientesActivos` (ficha completa de los 2.000+ clientes) queda para las pantallas de escritorio que todavía la usan
- `orders/{orderId}` — Pedidos
- `catalogo` — Catálogo de productos (nombre, unidad, foto). Los **precios vienen de Tango**: `preciosTango/{redonhielo|rolito}` (listas y especiales, los escribe la sync diaria `syncPreciosTango`) y `users.preciosTango` (precios resueltos por cliente). Las listas propias de la app (`listas-precios`) se eliminaron el 2026-09-03; `historialPrecios` queda solo como registro viejo
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
- **Supervisor (calle):** ficha del cliente (`/supervisor/cliente/:uid`, secciones en `src/components/supervisor/ficha/`): saldo + composición PDF, contacto (llamar/WhatsApp), domicilios (Maps), heladeras (service/comodato), pasar a logística (pedido con `orders.origenSupervisor` → Bandeja `date = ayer`, o `visitas-puntuales.origenSupervisor` sin chofer; `functions/triggers/supervisor.ts` avisa por push a logística/super_admin), historial (índices `clienteId + fecha DESC` en ventasCamion/ventasVentanilla/cobranzas) y alertas de mora (`config/cobranzas.alertasMora`, editable en Ajustes generales; regla en `utils/mora.ts`). `saldosTango` (cache de composición de saldos), `facturasArchivadas/{empresa}-{clave}` (índice de PDFs de facturas de Tango que administración guarda desde Recupero de facturas; el PDF va a Storage `facturas/{empresa}/{clave}.pdf`; Tango no entrega facturas por API). La clave es el número con formato Tango (`utils/facturaClave.ts`) y coincide con `factura.puntoVenta/numero` (ARCA) o `comprobanteInterno` (promo) de las ventas de la app, así la ficha del cliente regenera las de la app y baja las archivadas (`services/facturaAdeudadaService.ts`). El bucket tiene CORS GET para los orígenes de la app (necesario para `getBlob`). **Comprobantes de Tango en la app** (2026-09-09): `tangoComprobantes/{empresa}_{codigo}` (índice por código de cliente: facturas/NC/ND de 13 meses con estado y sus remitos; remitos con estado P/F/A) y `tangoComprobanteDetalle/{empresa}_{tipo}_{numero}` (renglones, CAE, cliente, CAI del talonario) los publica el lector `scripts/tango/comprobantes-sync.mjs`, que corre adentro de `bridge-sql.mjs` en la VM (cada `config/tango.comprobantes.intervaloMin` min, default 60, y al abrir la ficha del cliente, una vez por cliente, vía `tango-consultas` tipo `sincronizarComprobantes`) leyendo SQL Server (GVA12/GVA53/STA14/STA20, relación factura ↔ remito en GVA54) con el usuario bridge. La ficha (`SeccionSaldo`) muestra Pendientes / Todas (12 meses), selector Todas / sucursal, el remito de cada factura y los remitos sin facturar; el PDF de una factura o remito de Tango se regenera en la app (`utils/comprobantesTango.ts`, `services/facturaAdeudadaService.ts`). Cada comprobante se entrega por WhatsApp (menú del sistema), **mail al cliente** (Cloud Function `enviarComprobantePorMail` con Resend y adjunto, destinatario = mail de la ficha de Tango, registro en `enviosComprobantes`) o descarga (`components/ui/MenuCompartirPdf.tsx`). Docs: `docs/tango/INTEGRACION.md` §35 y §35.6

### Variables de entorno

Prefijo `VITE_FIREBASE_*`: `API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`. Además `VITE_GOOGLE_MAPS_API_KEY` (Google Maps), `VITE_VAPID_PUBLIC_KEY` (web push), `VITE_RECAPTCHA_SITE_KEY` (App Check, reCAPTCHA v3) y `VITE_SENTRY_DSN` (Sentry — opcional; la observabilidad se activa solo si está presente). En CI, todas se inyectan como GitHub Secrets en `deploy.yml`. Los secretos de Cloud Functions (`RESEND_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `ORS_KEY` para OpenRouteService, `TANGO_BRIDGE_SECRET` para el bridge de Tango) se configuran con `firebase functions:secrets:set`, no en `.env`. El remitente de todos los mails (`FROM_EMAIL`, hoy `Rolito <comprobantes@rolito.com.ar>`; el dominio `rolito.com.ar` está verificado en Resend) va en `functions/.env`, que sí se commitea: al cambiarlo hay que redesplegar las functions que mandan mails.

### CI (GitHub Actions)

- `ci.yml` — typecheck (app + functions), ESLint y tests de reglas contra el emulador (instala Java 21, requerido por firebase-tools).
- `deploy.yml` — deploy a Firebase Hosting en cada push a `master`.

### Deploy manual (reglas y functions)

Solo el **hosting** se despliega solo (push a `master`). Reglas y functions van a mano:

- **Reglas:** `firebase deploy --only firestore:rules` (correr `npm run test:rules` antes). Índices: `--only firestore:indexes`.
- **Functions — OJO, footgun:** `functions/lib/` (el JS compilado) está **commiteado al repo** y `firebase.json` **NO** tiene hook `predeploy`. Si editás `functions/src/*.ts` y corrés `firebase deploy --only functions` sin compilar antes, se sube el JS viejo (o tira "No function matches the filter" para triggers nuevos). Siempre: `npm --prefix functions run build` → verificar que `lib/` refleje el cambio → deployar → **commitear el `lib/` regenerado**. Si son muchas functions, deployar de a ≤6-8 (`--only functions:a,functions:b,...`) por la cuota de Cloud Run. Y si son varias tandas seguidas, esperar unos minutos entre una y otra: el 2026-09-10 tres tandas de 6-7 al hilo terminaron en "Quota exceeded for total allowable CPU per project per region" (las revisiones viejas de Cloud Run todavía contaban) y hubo que redesplegar de a una.

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
