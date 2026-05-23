# Manual de Usuario — Rolito App

> Versión: Mayo 2026  
> Aplicación web progresiva (PWA) de gestión de pedidos y logística de distribución de hielo.

---

## Índice

1. [Acceso al sistema](#1-acceso-al-sistema)
2. [Cliente](#2-cliente)
3. [Chofer](#3-chofer)
4. [Comercial](#4-comercial)
5. [Gerente Comercial](#5-gerente-comercial)
6. [Facturación](#6-facturación)
7. [Logística](#7-logística)
8. [Super Administrador](#8-super-administrador)
9. [Flujo de creación de clientes](#9-flujo-de-creación-de-clientes)
10. [Estados de un pedido](#10-estados-de-un-pedido)

---

## 1. Acceso al sistema

La app tiene tres puertas de entrada según el tipo de usuario:

| Tipo de usuario | URL de acceso |
|---|---|
| Clientes | `/clientes` |
| Personal interno (comercial, logística, admin, facturación) | `/empresa` |
| Choferes | `/choferes` |

### Registro de cliente (nuevo cliente)

1. Ingresar a `/clientes` y hacer clic en **"Registrarse"**.
2. Completar razón social, nombre de contacto, CUIT, teléfono, email y contraseña.
3. Al enviar el formulario, la cuenta queda en estado **Borrador** (pendiente de aprobación).
4. El sistema notifica al equipo comercial. El cliente no puede operar hasta que el Gerente Comercial lo active.
5. Al activar la cuenta, el cliente recibe una notificación y puede ingresar normalmente.

### Recuperar contraseña

Desde cualquier pantalla de login, hacer clic en **"¿Olvidaste tu contraseña?"** e ingresar el email registrado. Se recibirá un enlace de restablecimiento por email.

---

## 2. Cliente

### Acceso
Ingresar a `/clientes` con email y contraseña.

---

### 2.1 Inicio (Dashboard)

Al ingresar, el cliente ve un resumen de su actividad:

- **Pedidos activos**: pedidos pendientes, confirmados o en camino (con badge de estado).
- **Botón "Nuevo pedido"**: acceso directo para hacer un pedido nuevo.
- **Historial reciente**: últimos pedidos entregados.
- **Pedidos recurrentes**: si el cliente tiene configurado un pedido recurrente, aparece un indicador con la próxima fecha programada.

---

### 2.2 Nuevo pedido

1. Hacer clic en **"Nuevo pedido"** en el menú o en el botón del dashboard.
2. **Seleccionar productos**: aparece el catálogo con los productos habilitados para el cliente y sus precios. Ingresar la cantidad deseada de cada producto.
3. **Fecha de entrega**: elegir la fecha en el campo de fecha (por defecto es hoy).
4. **Notas**: campo opcional para indicaciones especiales (ej.: "dejar en portería", "llamar antes").
5. Revisar el resumen del pedido en el panel lateral derecho.
6. Hacer clic en **"Confirmar pedido"**. Aparece un modal de confirmación con el detalle completo.
7. Al aceptar, el pedido se envía y el cliente recibe una confirmación. El equipo recibe una notificación automática.

> **Repetir un pedido anterior**: desde el Historial, hacer clic en el ícono de repetir de cualquier pedido entregado. Esto pre-carga las cantidades del pedido anterior en el formulario de nuevo pedido.

> **Clientes con múltiples sucursales**: si el cliente tiene más de una dirección de entrega, al ingresar a la app se le pide que elija la sucursal activa. El pedido se crea para esa sucursal.

---

### 2.3 Historial de pedidos

Muestra todos los pedidos del cliente, de más reciente a más antiguo:

- **Filtro por estado**: pendiente, confirmado, en camino, entregado, cancelado.
- **Detalle de cada pedido**: fecha, productos, dirección, estado, chofer asignado.
- **Cancelar pedido**: solo disponible si el pedido está en estado **Pendiente**. Hacer clic en "Cancelar" e ingresar el motivo.
- **Repetir pedido**: ícono de repetición disponible en pedidos entregados.

---

### 2.4 Mi perfil

Sección con los datos de la cuenta:

- **Datos fiscales**: razón social, CUIT, email, teléfono.
- **Lista de precios asignada**: si el gerente comercial asignó una lista, se muestra aquí con los precios vigentes.
- **Mis direcciones**: lista de direcciones de entrega guardadas, con mapa de ubicación.
- **Cambiar contraseña**: ingresar contraseña actual, nueva contraseña y confirmación. La nueva contraseña debe tener al menos 6 caracteres.

---

## 3. Chofer

### Acceso
Ingresar a `/choferes` con **usuario** (nombre asignado por el admin) y **PIN** numérico de 4 dígitos.

---

### 3.1 Mis entregas del día

Vista principal del chofer con todas las entregas asignadas para hoy:

- **Pendientes**: pedidos que aún no fueron entregados, ordenados por estado.
- **Entregados**: pedidos completados durante el día.
- **Contador de cajas/unidades**: resumen de carga total del día.

#### Registrar una entrega

1. Tocar el pedido correspondiente en la lista.
2. Se abre el modal de entrega con el detalle del cliente y los productos.
3. Confirmar las cantidades entregadas (se pueden ajustar en caso de entrega parcial).
4. Si la entrega es **parcial**, marcar el checkbox correspondiente y registrar el motivo.
5. Agregar una **nota de entrega** opcional (ej.: "el cliente no estaba, dejé con el encargado").
6. Tocar **"Registrar entrega"**. El estado del pedido pasa a **Entregado**.

---

### 3.2 Visitas del día

Debajo de los pedidos de entrega, aparece la sección de **Visitas programadas**:

- **Visitas de programa**: clientes que tienen programado un día de visita semanal/quincenal/mensual.
- **Visitas puntuales**: visitas extraordinarias agendadas manualmente por logística.

Para cada visita:
- Tocar **"Registrar"** para marcar la visita como realizada.
- Si no se pudo contactar al cliente, usar **"Sin contacto"** y seleccionar el motivo (nadie en el local, local cerrado, no atendió el teléfono, dirección incorrecta).

---

### 3.3 Hoja de ruta (PDF)

Botón **"Exportar PDF"** disponible cuando hay pedidos pendientes. Genera un PDF con:

- Nombre del chofer y fecha.
- Lista de entregas del día con dirección, cliente, productos y cantidades.
- Espacio para firma del cliente (en la versión impresa).

---

### 3.4 GPS y ubicación

- Mientras el chofer tenga pedidos pendientes asignados, la app **comparte automáticamente su ubicación GPS** cada 10 segundos con el equipo de logística.
- Esto permite que el panel de Monitoreo muestre la posición de todos los choferes en tiempo real.
- La ubicación se **pausa** automáticamente cuando la app queda en segundo plano.
- Al no quedar pedidos pendientes (todos entregados), el GPS se desactiva.
- El chofer puede ver su propia ruta en la pantalla **"Ver ruta"** (`/chofer/map`).

---

### 3.5 Ver ruta (mapa)

Mapa de Google Maps con:

- Marcadores de todos los puntos de entrega del día.
- Al tocar un marcador, aparece el nombre del cliente y la dirección.
- Botón para abrir la dirección en Google Maps (navegación).

---

### 3.6 Notificaciones push

Si el dispositivo lo permite, el chofer puede activar notificaciones push para recibir alertas cuando se le asigna un nuevo pedido. Se muestra un banner al ingresar; tocar el botón para habilitar.

---

## 4. Comercial

### Acceso
Ingresar a `/empresa` con email y contraseña.

---

### 4.1 Panel Comercial

Vista general del estado del negocio desde la perspectiva comercial:

- **Métricas del día**: pedidos activos, clientes pendientes de aprobación, choferes activos.
- **Mapa de choferes**: vista en tiempo real de la ubicación de todos los choferes activos.
- **Clientes inactivos**: alerta de clientes sin pedidos en los últimos 7 días.
- **Pedidos recientes**: últimos pedidos del día con estado y cliente.
- **Forecast de clima**: banda de pronóstico de temperatura y condiciones para los próximos días (útil para anticipar demanda).

---

### 4.2 Gestión de usuarios (`/usuarios`)

El comercial puede **crear clientes nuevos** (quedan en estado Borrador) y consultar la ficha de cualquier cliente.

#### Crear un cliente nuevo

1. Hacer clic en **"+ Nuevo cliente"**.
2. Completar: razón social, nombre de contacto, CUIT, teléfono, email y contraseña provisional.
3. El cliente queda en estado **Borrador** — no puede ingresar a la app hasta que el Gerente Comercial lo active.

#### Ver ficha de cliente

- Hacer clic en cualquier cliente de la lista para abrir su ficha completa.
- Desde la ficha se pueden ver: datos fiscales, código de cliente, lista de precios asignada, direcciones de entrega, programas de visita.
- El comercial **no puede** activar clientes ni asignar listas de precios (eso corresponde al Gerente Comercial).

---

### 4.3 Reporte de precios (`/comercial/reporte-precios`)

Tabla comparativa de todas las listas de precios activas con los precios de cada producto. Permite:

- Ver diferencias de precio entre listas.
- Exportar a Excel.

---

### 4.4 Historial de precios (`/comercial/historial-precios`)

Registro cronológico de todos los cambios de precios realizados:

- Fecha y hora del cambio.
- Lista afectada.
- Productos modificados con precio anterior y nuevo.
- Usuario que realizó el cambio.

---

### 4.5 Clima (`/admin/clima`)

Pronóstico extendido con temperatura y condiciones para los próximos 7 días. Útil para planificar la demanda de hielo.

---

## 5. Gerente Comercial

### Acceso
Ingresar a `/empresa` con email y contraseña.

El gerente comercial tiene acceso a todo lo del rol **Comercial**, más las siguientes capacidades exclusivas:

---

### 5.1 Activar clientes (acuerdo comercial)

1. Ir a **Usuarios** (`/usuarios`). Los clientes en estado **Borrador** aparecen con un badge naranja y se destacan al inicio de la lista.
2. Hacer clic sobre el cliente para abrir su ficha.
3. En la sección **"Cuenta"**, hacer clic en **"✓ Activar cliente"**.
4. Antes o después de activar, asignar la **lista de precios** correspondiente al acuerdo comercial (desplegable en la ficha).
5. Al activar, el cliente recibe una notificación y puede ingresar a la app.

---

### 5.2 Asignar lista de precios

- En la ficha de cualquier cliente activo o borrador, el gerente puede asignar o cambiar la lista de precios.
- También puede asignar **precios custom** por producto (precio especial para ese cliente en particular).
- Estos precios se reflejan automáticamente en el formulario de nuevo pedido del cliente.

---

### 5.3 Reporte de ventas (`/comercial/ventas`)

- Métricas de ventas por período: unidades entregadas, ingresos totales, comparativo mes anterior.
- Gráfico de entregas por día del mes.
- Tabla de top clientes por volumen.
- Desglose de ventas por producto.
- Exportar a Excel.

---

### 5.4 Historial de movimientos (`/movimientos`)

Vista unificada de todos los pedidos del sistema con filtros por estado, fecha y búsqueda por cliente o dirección.

---

## 6. Facturación

### Acceso
Ingresar a `/empresa` con email y contraseña.

---

### 6.1 Historial de movimientos (`/movimientos`)

Vista completa de todos los pedidos: estado, cliente, productos, dirección, fecha. Se puede filtrar y buscar. Acceso de solo lectura.

---

### 6.2 Asignar código de cliente (`/usuarios`)

La función principal del rol de facturación es asignar el **código de cliente interno** (código de facturación) a cada cuenta:

1. Ir a **Usuarios** (`/usuarios`).
2. Hacer clic sobre el cliente para abrir su ficha.
3. En la sección **"Código de cliente"**, ingresar el código interno del sistema de facturación.
4. Hacer clic en **"Guardar"**. El código queda asociado al perfil del cliente.

> El código de cliente es visible para logística y administración, pero no para el cliente mismo.

---

### 6.3 Reportes (solo lectura)

- **Reporte de ventas** (`/comercial/ventas`): métricas de volumen e ingresos.
- **Reporte de precios** (`/comercial/reporte-precios`): tabla comparativa de listas de precios.
- **Historial de precios** (`/comercial/historial-precios`): auditoría de cambios de precios.

---

## 7. Logística

### Acceso
Ingresar a `/empresa` con email y contraseña.

---

### 7.1 Panel de pedidos (`/admin`)

Vista central de todos los pedidos activos (últimos 90 días):

- **Filtro por estado**: todos, pendiente, confirmado, en camino, entregado, cancelado.
- **Filtro por fecha**: selector de fecha para ver pedidos de un día específico.
- **Búsqueda**: por nombre de cliente, dirección o producto.
- **Tarjeta de pedido**: muestra cliente, dirección, productos (resumidos), estado actual y chofer asignado.

#### Acciones sobre un pedido

- **Cambiar estado**: botones de avance en el flujo: Pendiente → Confirmado → En camino → Entregado.
- **Asignar chofer**: desplegable con la lista de choferes activos. Al asignar, el sistema envía una notificación push al chofer.
- **Reasignar chofer**: si el pedido ya tiene chofer asignado, se puede cambiar indicando el motivo.
- **Reprogramar**: cambia la fecha del pedido. Se registra la fecha original y el motivo.
- **Cancelar**: cancela el pedido con un motivo obligatorio.
- **Cambiar dirección de entrega**: modificar la dirección si el cliente indicó una distinta.
- **Exportar hoja de ruta (PDF)**: genera un PDF por chofer con todos sus pedidos del día.

#### Importar pedido desde PDF

Botón **"+ Importar PDF"** para cargar una orden de compra en formato PDF (de clientes que envían OC por email). El sistema extrae automáticamente los datos del pedido.

---

### 7.2 Planificación (`/admin/planificacion`)

Vista de planificación semanal con mapa integrado:

- **Selector de fecha**: navegar entre los próximos 7 días.
- **Lista de pedidos del día**: pedidos agrupados por chofer, con indicador de carga en pallets.
- **Mapa**: marcadores por chofer (cada color es un chofer diferente) y marcadores de visitas programadas.
- **Asignar pedido desde el mapa**: al hacer clic en un marcador sin chofer, se puede asignar directamente.
- **Pedido manual**: botón **"+ Pedido manual"** para crear un pedido en nombre de un cliente (por teléfono, WhatsApp, etc.).
- **Visita puntual desde el mapa**: hacer clic en el mapa y seleccionar "Agregar visita puntual" para agendar una visita en esa ubicación.
- **Editar catálogo de productos**: desde esta pantalla se puede modificar el catálogo global de productos activos.

---

### 7.3 Monitoreo GPS (`/admin/monitoreo`)

Mapa en tiempo real con la posición de todos los choferes que están activos (con pedidos pendientes):

- Cada chofer se muestra con un marcador de color diferente.
- Al tocar un marcador, aparece el nombre del chofer, teléfono y última actualización.
- Se actualiza automáticamente cada 10 segundos.

---

### 7.4 Reporte de incidencias (`/admin/incidencias`)

Registro de entregas parciales, reprogramaciones, reasignaciones y cancelaciones. Permite hacer seguimiento de excepciones operativas.

---

### 7.5 Visitas programadas (`/admin/visitas`)

Gestión de las visitas comerciales a clientes (sin necesidad de que haya un pedido):

#### Programas de visita (recurrentes)

- **Crear programa**: seleccionar cliente, chofer responsable, días de la semana y frecuencia (semanal, quincenal, mensual).
- **Editar / eliminar**: disponible desde la lista de programas.
- El chofer ve las visitas del día en su dashboard bajo "Visitas de hoy".

#### Visitas puntuales

- **Crear visita puntual**: seleccionar cliente, dirección, fecha, chofer responsable y notas.
- Útil para visitas extraordinarias fuera del programa regular.
- El chofer puede marcar la visita como realizada o registrar "sin contacto" con motivo.

---

### 7.6 Flota de vehículos (`/admin/flota`)

Gestión del parque de camiones:

#### Registrar un camión

1. Hacer clic en **"+ Nuevo camión"**.
2. Completar patente, marca, modelo y capacidad en pallets.
3. Seleccionar los canales de distribución habilitados para ese camión.
4. Guardar.

#### Asignar camión a chofer

1. En la columna del chofer correspondiente, hacer clic en **"Asignar camión"**.
2. Seleccionar el camión de la lista.
3. La asignación queda registrada con fecha y hora del día.

> **Alerta en el panel de pedidos**: si un chofer tiene pedidos activos pero no tiene camión confirmado para hoy, aparece una alerta en el panel de pedidos recordando asignar el vehículo.

---

### 7.7 Historial de precios (`/comercial/historial-precios`)

Acceso de solo lectura al registro de cambios de precios. Útil para verificar el precio vigente en una fecha determinada.

---

### 7.8 Historial de movimientos (`/movimientos`)

Vista unificada de todos los pedidos del sistema con filtros completos.

---

## 8. Super Administrador

El Super Admin tiene acceso completo a todas las funciones de todos los roles. Adicionalmente:

---

### 8.1 Gestión de usuarios (`/usuarios`)

Acceso completo:

- **Crear cualquier tipo de usuario**: clientes, comerciales, logística, facturación, gerentes, choferes.
- **Cambiar el rol** de cualquier usuario (selector editable).
- **Activar / desactivar** cualquier cuenta.
- **Asignar listas de precios** y precios custom a clientes.
- **Ver y editar código de cliente**.
- **Reparar índice CUIT**: botón de utilidad que reconstruye el índice CUIT → email para clientes que puedan tener el índice dañado.

#### Crear chofer

1. Hacer clic en **"+ Nuevo chofer"**.
2. Ingresar nombre, usuario (sin espacios, en minúsculas) y PIN de 4 dígitos.
3. El chofer queda activo inmediatamente y puede ingresar desde `/choferes`.

#### Crear personal interno

1. Hacer clic en **"+ Nuevo personal"**.
2. Ingresar nombre, email, contraseña provisional y rol.
3. El usuario queda activo inmediatamente.

---

### 8.2 Listas de precios (`/admin/precios`)

Gestión completa del catálogo de precios:

- **Crear lista de precios**: nombre, descripción, productos con precio y unidad.
- **Editar lista**: modificar precios, activar/desactivar productos.
- **Historial de cambios**: cada modificación queda registrada automáticamente con fecha, usuario y valores anteriores/nuevos.
- **Asignar lista a cliente**: desde la ficha del cliente en `/usuarios`.

---

### 8.3 Clima (`/admin/clima`)

Pronóstico meteorológico extendido. Disponible también para Logística y Comercial.

---

### 8.4 Limpieza de datos de prueba

Disponible solo para el Super Admin desde el panel de pedidos: botón **"Limpiar datos de prueba"** que elimina pedidos y registros de prueba del entorno de desarrollo.

---

## 9. Flujo de creación de clientes

Este es el flujo completo desde que se contacta un cliente nuevo hasta que puede operar:

```
Comercial crea el cliente
        ↓
  Estado: BORRADOR
        ↓
Gerente Comercial abre la ficha
        ↓
Negocia y define lista de precios
        ↓
Hace clic en "✓ Activar cliente"
        ↓
  Estado: ACTIVO
  Cliente recibe notificación
        ↓
Facturación asigna código de cliente interno
        ↓
Cliente puede operar normalmente
```

**Quién puede hacer qué:**

| Acción | Comercial | Gerente Comercial | Facturación | Super Admin |
|---|:---:|:---:|:---:|:---:|
| Crear cliente (borrador) | ✓ | ✓ | — | ✓ |
| Asignar lista de precios | — | ✓ | — | ✓ |
| Activar cliente | — | ✓ | — | ✓ |
| Asignar código de cliente | — | — | ✓ | ✓ |
| Cambiar rol de usuario | — | — | — | ✓ |

---

## 10. Estados de un pedido

```
PENDIENTE → CONFIRMADO → EN CAMINO → ENTREGADO
                                   ↘
                                  CANCELADO (desde cualquier estado anterior)
```

| Estado | Significado |
|---|---|
| **Pendiente** | El pedido fue recibido, aún no fue procesado por logística |
| **Confirmado** | Logística confirmó el pedido, será despachado en la fecha indicada |
| **En camino** | El chofer está en ruta con el pedido |
| **Entregado** | El chofer registró la entrega (puede ser parcial) |
| **Cancelado** | El pedido fue cancelado (por el cliente, logística o admin) |

> El cliente solo puede cancelar sus propios pedidos cuando están en estado **Pendiente**.  
> Logística puede cancelar en cualquier estado.

---

*Rolito App — Distribución de Hielo*  
*Para soporte técnico, contactar al administrador del sistema.*
