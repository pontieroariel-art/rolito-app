# Configuración de Firebase

## Servicios utilizados

- **Firebase Authentication** — Email/contraseña
- **Cloud Firestore** — Base de datos en tiempo real

## Configuración del proyecto

### 1. Crear proyecto en Firebase Console

1. Ir a [Firebase Console](https://console.firebase.google.com)
2. Crear un nuevo proyecto
3. Habilitar **Authentication** con el proveedor Email/Password
4. Crear una base de datos **Firestore** en modo producción

### 2. Variables de entorno

Copiar las credenciales del proyecto Firebase a `.env.local`:

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu-proyecto
VITE_FIREBASE_STORAGE_BUCKET=tu-proyecto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

> **Importante:** `.env.local` está en `.gitignore` y nunca debe commitearse.

### 3. Reglas de seguridad de Firestore

Copiar el contenido de `firestore.rules` a las reglas de Firestore en la consola:

```
Firestore → Rules → Pegar contenido de firestore.rules → Publish
```

### 4. Índices necesarios

Firestore requiere índices compuestos para las queries del chofer. Si aparece un error en la consola del navegador con un link para crear el índice, seguir ese link.

Índices requeridos:
- Colección `orders`: `driverId` (ASC) + `date` (ASC)

## Colecciones

### `users/{uid}`

Se crea automáticamente al registrar un usuario. Campos:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `email` | string | Email del usuario |
| `name` | string | Nombre completo |
| `phone` | string | Teléfono (opcional) |
| `role` | string | `admin`, `chofer` o `cliente` |
| `address` | string | Dirección de entrega |
| `createdAt` | Timestamp | Fecha de creación |

### `orders/{orderId}`

Cada pedido creado por un cliente. Campos:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `clientId` | string | UID del cliente |
| `clientName` | string | Nombre del cliente |
| `clientAddress` | string | Dirección de entrega |
| `clientPhone` | string | Teléfono del cliente |
| `products` | array | `[{ name: string, quantity: number }]` |
| `status` | string | Estado del pedido |
| `date` | Timestamp | Fecha de entrega solicitada |
| `driverId` | string \| null | Email del chofer asignado |
| `notes` | string | Notas adicionales |
| `createdAt` | Timestamp | Fecha de creación |
| `updatedAt` | Timestamp | Última actualización |

### `config/choferes`

Documento único con la lista de emails de choferes autorizados:

```json
{
  "emails": ["chofer1@email.com", "chofer2@email.com"]
}
```

Este documento se crea automáticamente (vacío) la primera vez que se consulta.

## Administrador

El email del administrador está hardcodeado en dos archivos:

- `src/context/AuthContext.tsx` — Para determinar el rol al hacer login
- `src/services/userService.ts` — Para asignar el rol al crear el documento de usuario

Para cambiar el admin, modificar la constante `ADMIN_EMAILS` en ambos archivos.

El email del admin también está en `firestore.rules` para las reglas de escritura.
