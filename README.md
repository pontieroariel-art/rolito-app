# Rolito - Distribución de Hielo

PWA para la gestión de pedidos de hielo a domicilio. Los clientes hacen pedidos, el administrador los gestiona y asigna a choferes, y los choferes ven sus entregas del día con ruta optimizada en Google Maps.

## Funcionalidades

### Cliente
- Registro e inicio de sesión con email/contraseña
- Crear pedidos seleccionando productos del catálogo
- Ver dashboard con pedidos activos y entregados
- Historial completo con filtros por estado
- Repetir pedidos anteriores con un click
- Editar perfil con autocompletado de dirección (Google Places)

### Administrador
- Panel con resumen de pedidos del día por estado
- Listado de todos los pedidos con búsqueda y filtros (estado, fecha, texto)
- Avanzar estado de los pedidos (pendiente → confirmado → en camino → entregado)
- Asignar/cambiar chofer a cada pedido
- Editar dirección de entrega
- Gestionar lista de choferes (agregar/quitar por email)

### Chofer
- Dashboard con entregas asignadas del día
- Marcar pedidos como entregados
- Abrir dirección en Google Maps
- Vista de mapa con ruta optimizada entre todas las paradas
- Llamar al cliente directamente

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18, TypeScript, Tailwind CSS 3 |
| Routing | React Router 6 |
| Estado | Zustand, React Context (auth) |
| Backend | Firebase Auth + Cloud Firestore |
| Mapas | Google Maps API (@react-google-maps/api) |
| Build | Vite |
| PWA | vite-plugin-pwa |
| Deploy | Vercel |

## Requisitos previos

- Node.js 18+
- Proyecto de Firebase con Authentication y Firestore habilitados
- API Key de Google Maps con Places API habilitada

## Instalación

```bash
git clone <repo-url>
cd rolito-app
npm install
```

Crear un archivo `.env.local` con las variables de Firebase y Google Maps:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_GOOGLE_MAPS_KEY=...
```

## Desarrollo

```bash
npm run dev       # Servidor de desarrollo
npm run build     # Build de producción
npm run preview   # Preview del build
```

## Estructura del proyecto

```
src/
├── components/
│   ├── layout/       # AuthLayout, Navbar, ProtectedRoute
│   └── ui/           # Button, Input, Modal, Badge, LoadingSpinner
├── context/          # AuthContext (autenticación + roles)
├── hooks/            # useOrders, useChoferes, useProfile, useGoogleMapsLoader
├── pages/
│   ├── auth/         # Login, Register, ForgotPassword
│   ├── client/       # ClientDashboard, NewOrder, OrderHistory, ClientProfile
│   ├── admin/        # AdminDashboard
│   └── chofer/       # ChoferDashboard, ChoferMap
├── services/         # firebase, authService, orderService, userService, configService
├── utils/            # constants (productos, estados), helpers (formateo de fechas)
└── types.ts          # UserRole, OrderStatus, Order, UserProfile, Product
```

## Roles y permisos

| Rol | Cómo se asigna |
|-----|----------------|
| `admin` | Email hardcodeado en `AuthContext.tsx` y `userService.ts` |
| `chofer` | Email agregado a `config/choferes` en Firestore (desde el panel admin) |
| `cliente` | Por defecto para cualquier usuario registrado |

## Licencia

Proyecto privado.
