# Guión de demo — Rolito App

## Intro (30 segundos)

> "Les mostramos la app que usamos para gestionar todo el ciclo de pedidos: desde que el cliente nos pide hasta que el chofer entrega. Todo en tiempo real, sin llamadas ni WhatsApp."

**Lo que resuelve:**
- El cliente pide desde el celular, sin llamar
- Logística organiza la ruta y asigna choferes en segundos
- El chofer tiene todo en el teléfono: ruta, mapa, y puede registrar la entrega
- Comercial ve los números del día y del mes en tiempo real

---

## Flujo de demo recomendado

Seguir este orden: cuenta una historia de principio a fin.

---

## 1. El cliente pide — Panel del cliente

**Mostrá:** `/dashboard` (loguear como cliente de prueba)

**Decí:**
> "El cliente entra a la app, ve sus pedidos del día y puede hacer uno nuevo en segundos."

**Clickear:** "Nuevo pedido"

**Pantalla `/nuevo-pedido`:**
- Mostrá cómo elige productos con los botones + / −
- Señalá que ve el precio de su lista asignada y el total estimado
- Elegí una fecha de entrega
- Enviá el pedido

**Talking points:**
- "El cliente ve solo los precios de su canal — no hay confusión"
- "Puede repetir el último pedido con un toque si siempre pide lo mismo"
- "Si tiene varias sucursales, elige la dirección de entrega de una lista"

**Mostrá también:**
- La sección de pedidos activos con el estado en tiempo real
- "Cuando el chofer sale, el cliente recibe una notificación push en el celular"

---

## 2. Logística organiza — Panel de admin

**Mostrá:** `/admin` (loguear como admin)

**Decí:**
> "Al mismo tiempo, en el panel de logística aparece el pedido. Desde acá confirmamos, asignamos el chofer y organizamos la ruta del día."

**Clickear:** el pedido recién creado → cambiar estado a "Confirmado"

**Mostrá:** el selector de chofer → asignar

**Talking point:**
- "El chofer recibe una notificación push en cuanto le asignamos el pedido"

**Ir a `/admin/planificacion`:**

**Decí:**
> "Acá vemos todos los pedidos de la semana. Para hoy, podemos ver cuántas unidades tiene asignadas cada chofer y si la capacidad del camión alcanza."

**Mostrá:**
- La barra de capacidad por camión (verde/naranja/roja)
- El mapa del día con los pins de cada entrega
- La sección "Sin asignar" con el dropdown para asignar rápido

---

## 3. El chofer en la calle — Panel del chofer

**Mostrá:** `/chofer` (loguear como chofer de prueba o mostrar en segundo dispositivo)

**Decí:**
> "El chofer abre la app en el celular y ve todos sus pedidos del día. No necesita papel ni llamadas."

**Mostrá:**
- La lista de entregas con nombre del cliente, dirección, productos
- El botón "Abrir en Maps" → abre Google Maps con la dirección
- El botón "Ver ruta en mapa" → ir a `/chofer/map`

**En `/chofer/map`:**

**Decí:**
> "Acá tiene la ruta optimizada. Puede saltearse una parada si no puede entregar y el sistema la reprograma al final de la ruta automáticamente."

**Mostrá:**
- El botón ⏭ para saltar una parada
- El banner amarillo "Ruta desactualizada — Recalcular"
- Volver atrás y marcar una entrega como entregada

**Al marcar entregado:**
- Mostrá el modal de entrega parcial (puede marcar cuántas unidades entregó realmente)
- "Si entregó menos de lo pedido queda registrado automáticamente"

---

## 4. Seguimiento en tiempo real — Vista comercial / admin

**Mostrá:** el mapa en vivo en `/comercial` o `/admin`

**Decí:**
> "Mientras el chofer reparte, acá vemos su posición en tiempo real. Si hay un problema en la calle lo vemos enseguida."

**Mostrá:**
- El pin del chofer moviéndose en el mapa
- Los pedidos actualizando estado (pendiente → en camino → entregado)

---

## 5. Reporte de ventas — Panel comercial

**Mostrá:** `/comercial/ventas`

**Decí:**
> "Al final del día — o del mes — el área comercial ve cuánto se entregó, qué productos, y quiénes son los clientes con mayor volumen."

**Mostrá:**
- KPIs del mes con comparación vs el mes anterior
- El gráfico de barras con la tendencia diaria
- La tabla de unidades por producto
- El ranking de clientes por volumen
- El botón "Exportar" → genera un Excel listo para analizar

---

## 6. Funciones extras (si hay tiempo)

### Pedidos recurrentes
> "Los clientes que siempre piden lo mismo los días martes y jueves pueden configurar un pedido automático. El sistema los genera solo, sin que nadie tenga que hacer nada."

### Notificaciones push
> "Toda la cadena recibe notificaciones: el cliente cuando el pedido está en camino, el chofer cuando le asignan un pedido, sin depender del WhatsApp."

### Pedidos externos / importar PDF
> "Si recibimos una orden de compra en PDF, la subimos a la app y extrae automáticamente el cliente, los productos y la fecha. En dos clicks está cargado el pedido."

### Gestión de precios por canal
> "Cada cliente tiene su lista de precios asignada. Comercio, supermercados, gastronomía — cada uno ve y paga lo suyo. Y si un cliente tiene precio especial en un producto, también se puede configurar."

---

## Cierre

> "Todo esto corre como app móvil — se instala desde el navegador, funciona sin conexión y manda notificaciones como cualquier app nativa. No hay que bajar nada de la tienda."

**Preguntas frecuentes que pueden surgir:**

| Pregunta | Respuesta |
|----------|-----------|
| ¿Necesita internet? | Sí para sincronizar. Offline puede ver los datos pero no enviar. |
| ¿Es compatible con iPhone y Android? | Sí, funciona en cualquier navegador moderno. |
| ¿Dónde están los datos? | En Firebase (Google), en la nube, con backup automático. |
| ¿Se integra con Tango? | Por ahora corren en paralelo. Los pedidos se registran acá, la facturación sigue en Tango. |
| ¿Cuántos choferes/clientes soporta? | No hay límite técnico. |
| ¿Se puede personalizar? | Sí, está construida a medida. |

---

## Tips para la demo

- **Tener todo precargado:** loguear las cuentas antes (cliente, admin, chofer) en pestañas distintas
- **Usar datos reales o verosímiles:** nombres de clientes reales, direcciones reales de CABA/GBA
- **Mostrar primero el celular del chofer** si tenés un segundo dispositivo — impacta mucho ver el GPS en vivo
- **No entrar en detalles técnicos** a menos que pregunten — el cliente quiere ver el flujo, no la arquitectura
- **Dejar que hagan preguntas** después de cada sección, no al final
