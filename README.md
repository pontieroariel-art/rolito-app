# Rolito App — Distribución de Hielo

PWA para la gestión integral de pedidos y logística de distribución de hielo. Cubre el ciclo completo: alta de clientes, toma de pedidos, planificación de repartos, seguimiento GPS de choferes y reportes comerciales.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Estilos | Tailwind CSS 3 |
| Backend / DB | Firebase Authentication + Cloud Firestore |
| Estado servidor | TanStack Query (React Query) |
| Routing | React Router 6 |
| Mapas | Google Maps API (`@react-google-maps/api`) |
| PWA | vite-plugin-pwa (service worker + notificaciones push) |
| Serverless | Netlify Functions (notificaciones email + push web) |
| Deploy | Firebase Hosting (frontend) + Netlify (functions) |

## Roles de usuario

| Rol | Portal de acceso | Capacidades principales |
|---|---|---|
| `cliente` | `/clientes` | Crear pedidos, ver historial, gestionar perfil y direcciones |
| `chofer` | `/choferes` (usuario + PIN) | Ver entregas del día, registrar entregas, GPS en tiempo real |
| `comercial` | `/empresa` | Crear clientes (borradores), reportes de precios y ventas |
| `gerente_comercial` | `/empresa` | Activar clientes, asignar listas de precios, reportes |
| `facturacion` | `/empresa` | Asignar código de cliente interno, acceso a reportes |
| `logistica` | `/empresa` | Panel de pedidos, planificación, monitoreo GPS, flota, visitas |
| `super_admin` | `/empresa` | Acceso completo a todo el sistema |

## Flujo de alta de clientes

```
Comercial crea borrador → Gerente Comercial activa + asigna lista de precios → Facturación asigna código interno
```

## Funcionalidades por módulo

### Cliente
- Registro con CUIT, razón social y datos fiscales
- Catálogo de productos con precios de su lista asignada
- Nuevo pedido con fecha, notas y repetición de pedidos anteriores
- Soporte multi-sucursal (selector de dirección al ingresar)
- Cancelación de pedidos pendientes con motivo
- Historial completo con filtros por estado
- Cambio de contraseña desde el perfil

### Chofer
- Login con usuario y PIN (sin email)
- Dashboard de entregas del día con contador de unidades
- Registro de entrega (total o parcial) con nota
- Visitas comerciales del día (programas recurrentes + visitas puntuales)
- Hoja de ruta exportable a PDF
- Mapa de entregas con Google Maps
- Compartir ubicación GPS cada 10 s (pausa automática en segundo plano)
- Notificaciones push al recibir nuevos pedidos

### Logística / Admin
- Panel de pedidos con filtros por estado, fecha y búsqueda
- Avanzar estados, asignar/reasignar choferes, reprogramar, cancelar
- Importar pedidos desde PDF (órdenes de compra)
- Planificación semanal con mapa por chofer y carga en pallets
- Pedidos manuales (por teléfono/WhatsApp)
- Monitoreo GPS en tiempo real de toda la flota
- Reporte de incidencias (parciales, reprogramaciones, reasignaciones)
- Gestión de flota (camiones: patente, modelo, capacidad, canales)
- Visitas programadas (semanal/quincenal/mensual) y puntuales
- Pronóstico del clima extendido

### Comercial / Gerente Comercial
- Panel comercial con métricas del día y mapa de choferes
- Reporte de ventas por mes (unidades, ingresos, top clientes, por producto)
- Reporte comparativo de listas de precios
- Historial de cambios de precios con auditoría completa

### Super Admin
- Gestión completa de usuarios (crear, editar rol, activar/desactivar)
- Listas de precios: crear, editar, asignar a clientes
- Precios custom por cliente
- Crear choferes (usuario + PIN) y personal interno

## Comandos

```bash
npm install       # instalar dependencias
npm run dev       # servidor de desarrollo (localhost:5173)
npm run build     # build de producción
npm run preview   # preview del build
```

## Variables de entorno

Crear `.env.local` en la raíz:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_GOOGLE_MAPS_KEY=
VITE_NETLIFY_FUNCTIONS_URL=   # URL de las Netlify Functions (ej: https://tu-sitio.netlify.app/.netlify/functions)
```

## Estructura del proyecto

```
src/
├── components/
│   ├── admin/        # ImportarPedidoModal, PedidoManualModal
│   ├── chofer/       # EntregaModal
│   ├── layout/       # Navbar, ProtectedRoute
│   └── ui/           # Button, Input, Modal, Badge, LoadingSpinner, AddressPickerField
├── context/          # AuthContext, BranchContext
├── hooks/            # useOrders, useChoferes, useListasPrecios, useHistorialPrecios, ...
├── pages/
│   ├── admin/        # AdminDashboard, PlanificacionPage, MonitoreoPage, FlotaPage, VisitasPage, ClimaPage, ...
│   ├── auth/         # Landing, LoginClientes, LoginEmpresa, LoginChofer, Register, ...
│   ├── chofer/       # ChoferDashboard, ChoferMap
│   ├── client/       # ClientDashboard, NewOrder, OrderHistory, ClientProfile, SelectSucursal
│   ├── comercial/    # ComercialDashboard, HistorialPreciosPage, ReportePreciosPage, ReporteVentasPage
│   └── shared/       # HistorialPage
├── services/         # firebase, authService, orderService, userService, flotaService, ...
├── types.ts
└── utils/            # constants, helpers, pdf, parsePdf
```

## Colecciones de Firestore

| Colección | Descripción |
|---|---|
| `users/{uid}` | Perfiles con rol, estado, lista de precios, código de cliente |
| `orders/{orderId}` | Pedidos (suscripción en tiempo real) |
| `listas-precios/{id}` | Listas de precios con productos y valores |
| `historialPrecios/{id}` | Auditoría de cambios de precios |
| `flota/{camionId}` | Vehículos del parque |
| `programas-visita/{id}` | Visitas recurrentes por cliente |
| `visitas-puntuales/{id}` | Visitas extraordinarias |
| `pedidos-recurrentes/{clientId}` | Pedidos automáticos programados |
| `ubicaciones/{driverEmail}` | GPS en tiempo real |
| `cuitIndex/{cuit}` | Índice CUIT → email para login de clientes |
| `choferIndex/{username}` | Índice usuario → email para login de choferes |

## Seguridad (Firestore Rules)

Las reglas están en `firestore.rules`. Para deployar:

```bash
npx firebase deploy --only firestore:rules
```

> Usar siempre la CLI directamente — el plugin de Firebase MCP no recoge el archivo local.

## Estados de un pedido

```
pendiente → confirmado → en_camino → entregado
                                    ↘ cancelado
```

## Manual de usuario

Ver [`MANUAL_USUARIO.md`](./MANUAL_USUARIO.md) para la guía completa de uso por rol.

---

Proyecto privado — Rolito Distribución de Hielo.
