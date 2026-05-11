# Arquitectura de Rolito App

## Visión general

Rolito es una SPA (Single Page Application) construida con React que funciona como PWA (Progressive Web App). Usa Firebase como backend serverless para autenticación y base de datos en tiempo real.

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Cliente    │────▶│   React SPA      │────▶│   Firebase      │
│  (Browser)   │◀────│   (Vite + PWA)   │◀────│  Auth + Firestore│
└─────────────┘     └──────────────────┘     └─────────────────┘
                           │
                           ▼
                    ┌──────────────────┐
                    │  Google Maps API  │
                    │  (Places + Dirs)  │
                    └──────────────────┘
```

## Capas de la aplicación

### 1. Servicios (`src/services/`)

Capa más baja que interactúa directamente con Firebase. Cada archivo encapsula operaciones de una colección o módulo:

- **`firebase.ts`** — Inicialización de Firebase. Exporta instancias de `auth` y `db` (Firestore).
- **`authService.ts`** — Registro, login, logout y reset de contraseña via Firebase Auth.
- **`userService.ts`** — CRUD del documento de usuario en Firestore (`users/{uid}`).
- **`orderService.ts`** — Crear pedidos, actualizar estado, asignar chofer, y suscripciones en tiempo real (`onSnapshot`) para pedidos de cliente, admin y chofer.
- **`configService.ts`** — Gestión de la lista de choferes almacenada en `config/choferes`.

### 2. Hooks (`src/hooks/`)

Encapsulan lógica de estado y suscripciones de Firestore para los componentes:

- **`useOrders.ts`** — Tres hooks: `useClientOrders` (pedidos del cliente logueado), `useAllOrders` (todos, para admin), `useDriverOrders` (asignados al chofer del día).
- **`useChoferes.ts`** — Lista de choferes con funciones para agregar/quitar.
- **`useProfile.ts`** — Lectura y actualización del perfil del usuario.
- **`useGoogleMapsLoader.ts`** — Carga del SDK de Google Maps con la librería Places, configurado para Argentina en español.

### 3. Contexto (`src/context/`)

- **`AuthContext.tsx`** — Provider global de autenticación. Escucha `onAuthStateChanged` de Firebase, resuelve el rol del usuario (admin/chofer/cliente) y expone `user`, `loading` y `setUser`.

### 4. Componentes (`src/components/`)

**Layout:**
- `AuthLayout` — Wrapper centrado con branding para las páginas de auth (login, registro, forgot password).
- `Navbar` — Barra de navegación responsive con links dinámicos según el rol. Incluye menú hamburguesa para mobile.
- `ProtectedRoute` — Route guard que verifica autenticación y rol antes de renderizar las rutas hijas.

**UI:**
- `Button` — 5 variantes (primary, outline, danger, ghost, success) con estado de loading.
- `Input` — Input estilizado con label.
- `Modal` — Modal con overlay, cierre con Escape y click fuera.
- `Badge` — Badge de estado de pedido con colores por estado.
- `LoadingSpinner` — Spinner con opción fullscreen.

### 5. Páginas (`src/pages/`)

Organizadas por rol en subdirectorios. Cada página incluye su propio Navbar.

## Flujo de datos

### Autenticación

```
Firebase Auth (onAuthStateChanged)
       │
       ▼
AuthContext.tsx ──▶ Resuelve rol:
       │            1. ¿Email admin hardcodeado? → admin
       │            2. ¿Email en config/choferes? → chofer
       │            3. Default → cliente
       ▼
ProtectedRoute ──▶ Verifica auth + rol → Renderiza o redirige
```

### Pedidos (tiempo real)

```
Componente (página)
       │
       ▼
useOrders hook ──▶ subscribeXxxOrders (service)
       │                    │
       ▼                    ▼
  Estado local ◀──── onSnapshot (Firestore)
  (se actualiza automáticamente)
```

Los pedidos se actualizan en tiempo real gracias a `onSnapshot`. Cuando el admin cambia un estado o asigna un chofer, el cambio se refleja instantáneamente en todos los clientes conectados.

## Modelo de datos

### Colección `users`

```typescript
{
  uid: string           // ID de Firebase Auth
  email: string
  name: string
  phone: string
  role: UserRole        // 'admin' | 'chofer' | 'cliente'
  address: string
  createdAt: Timestamp
}
```

### Colección `orders`

```typescript
{
  id: string            // ID autogenerado por Firestore
  clientId: string      // UID del cliente
  clientName: string
  clientAddress: string
  clientPhone: string
  products: Array<{ name: string, quantity: number }>
  status: OrderStatus   // 'pendiente' | 'confirmado' | 'en_camino' | 'entregado' | 'cancelado'
  date: Timestamp       // Fecha de entrega solicitada
  driverId: string | null  // Email del chofer asignado
  notes: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### Documento `config/choferes`

```typescript
{
  emails: string[]      // Lista de emails de choferes autorizados
}
```

## Flujo de estados de un pedido

```
pendiente ──▶ confirmado ──▶ en_camino ──▶ entregado
    │              │              │
    └──────────────┴──────────────┘
                   │
                   ▼
              cancelado
```

Solo el admin puede avanzar estados y cancelar. El chofer puede marcar como `entregado` desde su dashboard.

## Seguridad

Las reglas de Firestore (`firestore.rules`) definen:

- **users**: Solo el dueño puede leer/escribir su perfil. Admin puede leer todos.
- **orders**: Clientes pueden crear pedidos y leer los suyos. Admin lee/escribe todos. Chofer lee/actualiza los pedidos asignados a su email.
- **config**: Lectura para cualquier usuario autenticado. Escritura solo admin.

## PWA

Configurada via `vite-plugin-pwa` con:
- `registerType: 'autoUpdate'` — El service worker se actualiza automáticamente.
- Manifest con nombre, iconos SVG y colores del tema (`#0A1628`).
- Display standalone para experiencia nativa.

## Tema visual

Tema oscuro definido en `tailwind.config.js`:

| Token | Color | Uso |
|-------|-------|-----|
| `bg` | `#0A1628` | Fondo principal |
| `accent` | `#00C2FF` | Acciones principales, links |
| `success` | `#00D68F` | Estado entregado, confirmaciones |
| `surface` | `#0F2040` | Cards, navbar |
| `border` | `#1E3A5F` | Bordes |
| `muted` | `#4A6080` | Texto secundario |

Fuente: **Inter** (cargada desde Google Fonts).
