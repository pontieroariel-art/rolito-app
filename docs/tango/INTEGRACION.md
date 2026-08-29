# Integración Rolito App ↔ Tango Gestión

> Documento maestro de la integración. Acá se destila todo el conocimiento del "mundo Tango"
> aplicado a esta app: licencias, API, mapeo de datos, arquitectura y preguntas abiertas.
> Se actualiza a medida que llegan documentos, exportes y respuestas de Axoft.
>
> Última actualización: 2026-08-29

## 1. Contexto y decisión de timing

- La empresa (REDONHIELO S.A., CUIT 30-69766897-3) usa Tango Gestión en producción, llave `001174/003`, versión 21.1.0.3185 (sin soporte; Axoft va por T25/Delta 5).
- **Delta 6 sale en 1-2 meses** (dicho por Axoft, jul 2026) con cambios significativos.
- **Decisión (2026-07-19):** no pagar la llave testing de 90 días hasta que Delta 6 esté disponible. Mientras tanto se desarrolla todo lo que no depende de la versión instalada (ver §4), porque la integración va por la **API cloud de Tiendas**, cuyo contrato no cambia con las tablas internas de cada versión de escritorio.
- Plan general: sandbox en la nube (llave testing + VM) → validar integración → recién después migrar el Tango productivo. Ver presupuestos y alternativas (Axoft / BETA connect / TC Cloud) en las notas del proyecto.
- **Actualización (2026-08-18/20):** se abandonó el plan de sandbox aislado. Se actualizó DIRECTAMENTE la llave productiva (001174) a Delta 6 Gold (motivo: "facturación en calle", ausente en la v21 sin soporte) y **el servidor de Tango Delta 6 ya está corriendo en la nube** (migración hecha por TC Servicios Informáticos). Con la infraestructura resuelta, el gate para diseñar el detalle técnico pasa a ser exclusivamente las dos preguntas de la §6 (cuál API está habilitada, cómo quedó expuesto el servidor) — ver ahí.

## 2. Licencias — qué hay y qué falta confirmar

Según factura Axoft A00006-00260794 (04/12/2025), la llave `001174/003` incluye:

| Código | Ítem | Estado |
|---|---|---|
| TSGPPA15GD | Extensión VE+CO+TE+CF+CN+SU+CH, 15 puestos Gold | Pagada |
| CT MUGD | Extensión Central Multiusuario Gold | Pagada |
| **TSAABMMUGD** | **Extensión API ABMs y Consultas Live** | **Bonificada ($0) — YA ACTIVA en la licencia** |
| CSNEXO | Apps Nexo gratuitas | Incluidas |

**Pregunta crítica abierta (Silvina, Axoft):** ¿la "Extensión API ABMs y Consultas Live" es lo mismo que la **API de Tango Tiendas** (REST cloud, requiere licencia "Tango Tiendas Full" + módulo tesorería según la doc), o es otra API distinta (local, tipo ABM)? De la respuesta depende el camino técnico. Segunda pregunta: si la llave testing pagada post-lanzamiento se genera directo en Delta 6.

**CONFIRMADO (2026-08-25), directo del servidor productivo — Administrador general → Datos de licencia → solapa API:**

| Ítem | Habilitada |
|---|---|
| ABMs y consultas Live | **Sí** |
| Transacciones Tango Ventas | **No** |
| Transacciones Tango Contabilidad | **No** |

Esto confirma dos cosas: (1) la API de **Plataforma/ABM** (Clientes, Proveedores, Artículos, Cuentas de tesorería — GET/POST/PUT/DELETE) está activa y lista para usar — es API distinta de Tango Tiendas, ya no es una incógnita. (2) **No está licenciada la escritura de pedidos/facturas** por esta vía (Transacciones Ventas = No) — el plan de "la app crea el pedido y lo sube a Tango" necesita, para ESTE camino, contratar ese módulo aparte a Axoft, o bien resolverse por la API de Tango Tiendas (licencia distinta, todavía sin confirmar). **Alcance inmediato desbloqueado sin costo adicional:** sincronizar clientes/artículos/stock (lectura y escritura de maestros) vía ABM API.

## 3. API de Tango Tiendas — resumen técnico

Fuente: documentación oficial pública en `github.com/TangoSoftware/ApiTiendas` (relevada 2026-07-19).

- **Base URL:** `https://tiendas.axoft.com/api/Aperture/` (API en la nube de Axoft; Tango de escritorio se sincroniza vía Nexo — la app nunca habla con el servidor de Tango directamente).
- **Auth:** header `accesstoken` (un token por cuenta, se genera desde la config de Tango Tiendas). Verificación: `POST /dummy`. TLS ≥ 1.2.
- **Solo pesos argentinos**, montos con 2 decimales, redondeo half-up.

### Lectura (GET, paginados)

`Product`, `Customer`, `PriceList`, `Price`, `PriceByCustomer`, `DiscountByCustomer`, `StockBalance`, `Store`, `Warehouse`, `Measure`, `Seller`, `Currency`, `Transport`, `SaleCondition`, `ClassifierArticle`, `ClassifierCustomer`, `ForeignCurrencyQuote`, `Publication`, `InvoiceVoucher`, `Counterfoil`, `OrderStatus`.

Paginación: `pageSize` (máx 5000) + `pageNumber` (desde 1), respuesta `{ Paging: { PageNumber, PageSize, MoreData }, Data: [] }`.

### Escritura (pedidos)

- `POST /order` (uno) y `POST /order/batch` (máx 25 por request).
- Los pedidos pueden tener fecha de hasta 30 días atrás.
- Cancelación: mismo POST con `CancelOrder: true` + `CancelReason` + `CancelDate`.
- Respuesta batch por ítem: `{ OrderID, Inprocess, ValidationException? }`.

Campos principales del pedido: `OrderID` (único, idempotencia), `OrderNumber`, `Date`, `Total`, `Customer{...}`, `OrderItems[]`, `Shipping{...}`, opcionales `SellerCode`, `TransportCode`, `SaleConditionCode`, `PriceListNumber`, `WarehouseCode`, `Comment` (280), `CashPayments[]`/`Payments[]` (tarjetas).

Matching de cliente en Tango (orden de prioridad): `Code` → `DocumentType+DocumentNumber` → `Email` → email en contactos → usuario de tienda. **Para nosotros: mandar siempre `Code` = código de cliente Tango.**

### Webhooks (push de Tango hacia nosotros)

URL configurable (TLS 1.2). Tópicos (case sensitive): `OrderProcessed`, `OrderObserved`, `OrderRejected`, `OrderBilled`, `InvoiceFile` (PDF de factura), `PriceProductUpdate`, `StockProductUpdate`. Payload: `{ Topic, Resource, Message }`.

→ Implicancia: los webhooks pueden apuntar a una **Cloud Function HTTPS** nuestra; con `PriceProductUpdate`/`StockProductUpdate` la bajada de precios/stock puede ser por evento en vez de polling.

### Tablas de referencia útiles

- `DocumentType`: 80=CUIT, 86=CUIL, 96=DNI, etc.
- `IvaCategoryCode`: RI, RS (monotributo), CF, EX, etc.
- `ProvinceCode`: 0=CABA, 1=Buenos Aires, …

## 4. Arquitectura de integración

```
App (React) ──► Firestore ──► Cloud Functions ──► tango-outbox (cola en Firestore)
                                                        │
                                              worker (Function programada
                                               o bridge en VM si hace falta)
                                                        │ HTTPS
                                                        ▼
                                            tiendas.axoft.com (API cloud)
                                                        ▲
                                     webhooks ──► Function HTTPS nuestra
```

Principios acordados:

1. **Cola de salida (`tango-outbox`)**: cada evento a informar a Tango (pedido nuevo, cancelación) es un documento con estado (`pendiente` → `enviado` → `confirmado` / `error`), reintentos con backoff e **idempotencia** (guardar el ID que Tango asigna; `OrderID` nuestro = id del pedido en Firestore).
2. **Interruptor general**: `config/tango { enabled: false }`. Código deployado pero dormido; se enciende sin redeploy. Apagarlo nunca afecta la operación de la app.
3. **La app jamás depende de Tango para operar**: si Tango/Axoft está caído, la cola acumula y reintenta. Logística no se entera.
4. **Escrituras a Tango SOLO por vías oficiales** (API). Nunca INSERT directo en SQL — Delta 6 y sus tablas nuevas refuerzan esta regla.
5. **Fuente de verdad por entidad (tentativo, a confirmar):** clientes y precios manda Tango (bajada hacia la app); pedidos los crea la app (subida hacia Tango).
6. **Panel `/admin/tango`** (solo super_admin): estado de la cola, últimos envíos, errores, botón de pausa.
7. Bridge en la VM: solo si hace falta para datos que la API no exponga (ej. cta. cte., facturas viejas). Los flujos principales van por la API cloud directo desde Functions.

## 5. Mapeo tentativo app ↔ Tango

### Pedido: `orders/{id}` → `POST /order`

| App (`Order`) | API Tiendas | Nota |
|---|---|---|
| `id` (doc Firestore) | `OrderID` | clave de idempotencia |
| `numeroOC` o correlativo propio | `OrderNumber` | definir numeración visible |
| `date` | `Date` | formato `yyyy-MM-ddTHH:mm:ss` |
| Σ `products[].price × quantity` | `Total` | recalculado server-side (ya existe `validarPreciosPedido`) |
| `notes` | `Comment` | truncar a 280 |
| user.`codVendedor` | `SellerCode` | del perfil del cliente |
| user.`listaPreciosId` → nº Tango | `PriceListNumber` | requiere tabla de equivalencias listas app ↔ Tango |
| `clientAddress` + datos sucursal | `Shipping{...}` | dirección de entrega, horarios (`DeliveryHours`), `DeliveryDate` |
| `motivoCancelacion` | `CancelReason` (+`CancelOrder`) | flujo de cancelación |

### Ítems: `OrderProduct[]` → `OrderItems[]`

| App | API | Nota |
|---|---|---|
| `productoId` → código Tango | `SKUCode` (código de artículo Tango) | **requiere tabla de equivalencias catálogo app ↔ artículos Tango** |
| `name` | `Description` | |
| `quantity` | `Quantity` | |
| `price` | `UnitPrice` | |

### Cliente: `users/{uid}` → `Customer`

| App (`UserProfile`) | API | Nota |
|---|---|---|
| `codigoCliente` | `Code` | **pasa a ser el código de cliente de Tango** (decisión ya tomada) |
| `cuit` | `DocumentNumber` + `DocumentType: 80` | |
| `razonSocial` | `BusinessName` | |
| `email` | `Email` | |
| `telefono` | `PhoneNumber1` | |
| `addresses[esPrincipal]` | `Street`/`City`/… | parsear dirección si hace falta |
| — | `IvaCategoryCode` | **falta en la app** — traer de Tango en la bajada de clientes |
| — | `ProvinceCode` | ídem |

### Bajadas Tango → app (lectura periódica o webhook)

| Tango | App | Mecanismo |
|---|---|---|
| `Customer` | `users` (campos comerciales) | sync programada + upsert por `Code`/CUIT |
| `Price` / `PriceByCustomer` | `listas-precios` | webhook `PriceProductUpdate` o polling |
| `Product` | `config/catalogo` | polling de baja frecuencia |
| `OrderStatus` / webhooks de pedido | `orders.tango{ estado, numero }` | actualizar estado del pedido en la app |

## 6. Preguntas abiertas

1. ~~¿"APIs Tipo ABM" y/o Tango Tiendas están habilitadas?~~ **RESUELTO (2026-08-25)** — ver §2: es la API de Plataforma/ABM, confirmada activa, token de desarrollador ya generado (guardado por Ariel, no en el repo).
2. ~~¿Cómo quedó expuesto el servidor?~~ **RESUELTO (2026-08-25):** el servidor responde en `http://rhielotg:17000/company/{empresa}/...` — **HTTP plano, hostname interno** (no resuelve desde internet, "No es seguro" en el navegador). Esto **descarta exponerlo directo** — confirma que la arquitectura tiene que ser bridge en la misma VM/red (nunca Cloud Functions pegándole directo por internet a este host). TC Servicios Informáticos ya confirmó que conectar la app es viable — falta coordinar la instalación del bridge con ellos (avisarles, no pedirles permiso de dueños).
3. Numeración: ¿`OrderNumber` lo definimos nosotros o Tango exige talonario (`OrderCounterfoil`)? → probar contra el server real. (Nota: esto aplica a Tango Tiendas, no a la API de Plataforma que vamos a usar — la API de Plataforma no tiene endpoint de pedidos, ver abajo.)
4. ¿Qué `SaleConditionCode` usar por cliente? (condición de venta vive en Tango) → export de clientes.
5. ~~Proceso exacto de generación del token~~ **RESUELTO** — Menú de usuario (ícono arriba a la derecha) → "Desarrollador" → "Generar".
6. **[NUEVA]** Nombre exacto de `{process}` para Clientes/Artículos en la API de Plataforma, y el esquema de campos de la respuesta — pendiente de probar un GET real contra `Api/Get/Clientes/.../.../...` (o el nombre real del proceso) desde dentro de Tango.
7. **[NUEVA, 2026-08-27]** ¿Qué pantalla/proceso puntual de Tango usa hoy el administrativo para cargar producción de hielo a mano (¿ingreso de stock? ¿ajuste de stock? ¿orden de producción?), y está ese proceso expuesto por la API de Plataforma/ABM (como Clientes, `process=2117`) o requiere un módulo aparte no confirmado — ver §8.

### 6.1 API de Plataforma (ABM) — confirmada, reemplaza la sección 3 como camino principal

A diferencia de lo relevado en julio (Tango Tiendas, e-commerce), la API que **sí está licenciada y con token generado** es distinta:

- **Base:** `http://rhielotg:17000/Api/{Accion}` (HTTP, host interno — solo alcanzable desde dentro de la red/VM, de ahí la necesidad del bridge). La empresa NO va en la URL, va como header (ver abajo).
- **Auth (headers en cada request):** `ApiAuthorization` (el token de desarrollador) + `Company` (número de empresa, `1` para Redonhielo).
- **Parámetros:** van como query string / data, no como segmentos de path pese a lo que sugiere la doc genérica (`{process}` etc.) — confirmado con un request real:
  `GET http://rhielotg:17000/Api/Get?process=2117&pageSize=10&pageIndex=0&view=`
- **Endpoints:**
  - `POST Api/Create` (`process=...` + body) — alta
  - `PUT Api/Update` — modificación
  - `DELETE Api/Delete` (`process=...&id=...`) — baja
  - `GET Api/Get` (`process`, `pageSize`, `pageIndex`, `view`) — consulta paginada
  - `GET Api/GetById` (`process`, `id`) — un registro
  - `GET Api/GetByFilter` (`process`, `view`, `filtroSql`) — consulta con filtro
- **`process=2117` = Clientes** (confirmado, probado contra el server real 2026-08-25). Todavía no sabemos el código de Artículos/Proveedores/Cuentas de tesorería — se consigue igual: parado en esa pantalla del ABM, abrir "Apertura > API" y ver qué `process` trae precargado.
- Procesos confirmados con ABM disponible (según licencia): **Clientes, Proveedores, Artículos, Cuentas de tesorería**.
- **Respuesta real de Clientes** confirmada completa (2026-08-25), probada contra el servidor real — `{ resultData: { list: [...], pageIndex, pageSize, totalCount, totalPages, hasPreviousPage, hasNextPage }, succeeded: true }`. **6083 clientes en total** en Tango. Campos relevantes (nombres reales, estilo Tango clásico — muchos truncados a 8-10 caracteres):

| Campo Tango | Significado | Equivalente en la app |
|---|---|---|
| `ID_GVA14` | ID interno numérico (para `GetById`/`Update`/`Delete`) | — (nuevo, no existe hoy) |
| `COD_GVA14` | Código de cliente Tango | **NO es el mismo esquema que `codigoCliente` de la app** — ver aviso abajo |
| `RAZON_SOCI` | Razón social | `razonSocial` |
| `NOM_COM` | Nombre comercial | `nombreComercial` |
| `CUIT` | CUIT (con guiones) | `cuit` (match confiable entre sistemas) |
| `E_MAIL` | Email | `email` |
| `TELEFONO_1`/`TELEFONO_2`/`TELEFONO_MOVIL` | Teléfonos | `phone`/`telefono2` (ojo: en la data real algunos vienen con texto libre mezclado, ej. `"0810-3216-2576 pagos"` — no asumir formato limpio) |
| `HABILITADO` | Booleano activo/inactivo | `estado` ('activo'/'inactivo') |
| `DOMICILIO` / `DIR_COM` | Dirección (fiscal / comercial) | `address` / `addresses[].address` |
| `LOCALIDAD`, `C_POSTAL` | Localidad, CP | `addresses[].localidad`, `codigoPostal` (falta en la app) |
| `GVA18_CODIGO`/`_DESCRIPCION` | Provincia | `ProvinceCode` — falta en la app |
| `COD_CATEGORIA_IVA`/`DESC_CATEGORIA_IVA` | Categoría IVA (ej. "RI") | `tipoIva` — falta en la app |
| `GVA01_COND_VTA`/`_DESC_COND` | Condición de venta (ej. "7 DIAS F.F.") | `condicionVenta` — la app hoy solo tiene 2 valores fijos (`Contado`/`Cuenta corriente`), Tango maneja un catálogo más rico, hay que decidir cómo mapear |
| `GVA10_NRO_DE_LIS`/`_NOMBRE_LIS` | Lista de precios (número + nombre) | `listaPreciosId` — requiere tabla de equivalencias con `listas-precios` |
| `GVA23_CODIGO`/`_DESCRIPCION` | Vendedor/zona (ej. "AD"="ADMINISTRACION") | `codVendedor` |
| `GVA24_CODIGO`/`_DESCRIPCION` | Transporte (ej. "01"="CAMION") | — |
| `FECHA_ALTA` | Fecha de alta | `fechaAlta` |
| `SUCURSAL_NRO`/`_DESC` | Sucursal DE REDONHIELO que atiende (no confundir con sucursal del cliente) | — |

**⚠️ Hallazgo importante (2026-08-25):** el `COD_GVA14` real de Tango es **numérico puro** (ej. `092435`, `122136`) — no tiene relación con el `codigoCliente` alfanumérico que ya usa la app hoy (ej. `MDP214`, `FC.570`, con prefijo de zona), que viene del Excel histórico de clientes/heladeras, no de Tango. La decisión tomada en julio ("`codigoCliente` de la app pasa a ser el código de Tango") **no se puede aplicar tal cual** — son dos numeraciones distintas y no hay forma de saber la correspondencia sin cruzarlas. **Camino recomendado:** cruzar por **CUIT** (existe y es confiable en ambos sistemas), guardar el `COD_GVA14`/`ID_GVA14` de Tango como campo NUEVO y separado (ej. `codigoTango`) en el perfil del cliente, sin tocar el `codigoCliente` existente — decisión pendiente de confirmar con Ariel.
- **Importante:** esta API, con solo "ABMs y consultas Live" licenciado, NO permite crear pedidos/facturas — eso es "Transacciones Tango Ventas" (misma superficie técnica, módulo de licencia aparte). Ver §6.2: la API de transacciones está documentada públicamente y es la que Axoft respondería habilitar ("API Ventas").

### 6.2 API de Transacciones de Ventas ("API Ventas" / Pedidos) — relevada 2026-08-29, a la espera de habilitación

> Fuente oficial: `github.com/TangoSoftware/TangoDeltaApi` (repo "Pedidos de Ventas", con PDF
> `src/Implementations/PedidosApiConsole/API Pedidos - TangoSoftware.pdf` y código C# de ejemplo).
> Es la API que Axoft debe confirmar/habilitar (respuesta esperada: lunes 2026-09-01). En la
> licencia actual figura "Transacciones Tango Ventas: **No**" (§2) — habilitarla es el gate.

**Dato clave de arquitectura: es la MISMA superficie que la API de Plataforma (§6.1).** El ejemplo
oficial usa `TangoUrl = "http://localhost:17000"`, headers `ApiAuthorization` + `Company`, y los
mismos endpoints `Api/Get`, `Api/GetById`, `Api/GetByFilter`, `Api/Create` con `process=...`.
Implicancias:

1. **El bridge en la VM sigue siendo necesario** para este camino (host interno `rhielotg:17000`,
   HTTP plano — igual que §6.1). No es la API cloud de Tiendas.
2. El token de desarrollador ya generado y el patrón de requests ya probado (2026-08-25) sirven
   tal cual — al habilitarse la licencia solo se suma un `process` nuevo.
3. Toda la infraestructura ya construida (cola `tango-outbox`, `bridge-listener.mjs`,
   `isTangoBridge()`, flags en `config/tango`) aplica sin cambios: completar el worker =
   implementar `POST Api/Create?process=19845` en el bridge.

**Detalles del servicio de Pedidos:**

- **`process = 19845`** (constante `ProcessId` en `PedidosServices.cs` del repo oficial).
- Métodos que funcionan: `Get`, `GetById`, `GetByFilter`, `Create` (Post), más **`Close`**
  (cerrar) y **`Cancel`** (anular). **`Update`/`Delete` NO funcionan por el momento** (dicho
  explícito del README oficial).
- `GetByFilter` trabaja contra la vista **`AXV_PEDIDO`** (no la tabla `GVA21`) — igual que
  Clientes/Artículos/Proveedores usan `AXV_*`.
- Respuesta del `Create`: `{ Succeeded, SavedId, Message, ExceptionInfo }` — `SavedId` es el
  `ID_GVA21` del pedido creado (guardarlo en el outbox para idempotencia/trazabilidad).
- **Crea PEDIDOS** (comprobante de venta en GVA21). La facturación/remito posterior corre por el
  circuito interno de Tango (Facturador). El repo oficial dice que la doc de **"Facturación de
  Ventas"** por API viene "próximamente" — hoy por API solo se ingresan pedidos.

**Esquema JSON del pedido (`PedidoData`)** — campos principales (todos IDs internos de Tango,
resueltos vía `GetByFilter` sobre el proceso correspondiente):

| Campo | Qué es | Cómo se resuelve | Obligatorio |
|---|---|---|---|
| `ID_GVA43_TALON_PED` | Talonario de pedido | a definir con el implementador | práctico sí |
| `FECHA_PEDIDO` / `FECHA_ENTREGA` | Fechas | de la app | — |
| `ID_GVA14` + `ES_CLIENTE_HABITUAL: true` | Cliente | **ya lo tenemos**: `users/{uid}.idGva14Tango` | sí (o cliente ocasional) |
| `ID_DIRECCION_ENTREGA` | Dirección de entrega | del `GetById` del cliente (`DireccionEntrega[]`) | — |
| `ID_GVA01` | Condición de venta | `GetByFilter("GVA01.COND_VTA = n")` | — |
| `ID_GVA10` | Lista de precios | `GetByFilter("GVA10.NOMBRE_LIS = '...'")` — mapear Promo/Contado | — |
| `ID_GVA23` | Vendedor | `GetByFilter("COD_VENDED = n")` | — |
| `ID_GVA24` | Transporte | `GetByFilter("GVA24.COD_TRANSP = '...'")` | — |
| `ID_STA22` | **Depósito** | `GetByFilter("STA22.COD_STA22 = n")` — **clave para depósito-camión** | — |
| `ID_MONEDA` | Moneda | `GetByFilter("MONEDA.COD_MONEDA = 'PES'")` | **sí (Required.Always)** |
| `PORCENTAJE_DESCUENTO_GENERAL` | Descuento general | 0 si no aplica | **sí (Required.Always)** |
| `ESTADO` | 1 = entra al circuito de aprobación, **2 = ingresa aprobado** | decisión de circuito | — |
| `COMPROMETE_STOCK` | Compromete stock | decisión de circuito | — |
| `OBSERVACIONES` (8000) / `LEYENDA_1..5` (60) / `NOTA_PEDIDO_DTO[]` | Textos | de la app | — |
| `VALIDA_LIMITE_CREDITO`, `APLICA_DESCUENTO_CLIENTE`, `CALCULA_PROMOCIONES` | Flags de negocio | decisión de circuito | — |
| `RENGLON_DTO[]` | Renglones | ver abajo | sí |
| `CLIENTE_OCASIONAL_DTO[]` | Cliente ocasional (razón social, domicilio, `ID_TIPO_DOCUMENTO_GV` 23=CUIT, `ID_CATEGORIA_IVA` 1=RI, `ID_GVA18_PROVINCIA`, …) | solo si `ES_CLIENTE_HABITUAL: false` | — |

**Renglón (`RenglonDto`):**

| Campo | Qué es |
|---|---|
| `ID_STA11` | Artículo — `GetByFilter("AXV_ARTICULO.COD_STA11 = '...'")` → **requiere tabla de equivalencias catálogo app ↔ artículos Tango** |
| `MODULO_UNIDAD_MEDIDA` | `"GV"` (unidad de ventas) en los ejemplos oficiales |
| `CANTIDAD_PEDIDA` | Cantidad |
| `CANTIDAD_A_FACTURAR` / `CANTIDAD_A_DESCARGAR` | Control del circuito de facturación/descarga de stock |
| `PRECIO` | Precio unitario (si se omite, "se puede buscar el precio por lista de precios automáticamente" según el ejemplo oficial) |
| `PORCENTAJE_BONIFICACION` | Bonificación del renglón |
| `ID_STA22` | Depósito por renglón (pisa el de cabecera) |
| `PLAN_DE_ENTREGA_DTO[]` | Cantidad + fecha de entrega parcial |

**Procesos relacionados cuyos `process` IDs hay que relevar** (mismo método que Clientes=2117:
pararse en la pantalla del ABM → "Apertura > API"): Artículos, Condiciones de venta (GVA01),
Listas de precios (GVA10), Vendedores (GVA23), Transportes (GVA24), Depósitos (STA22), Monedas,
Talonarios (GVA43), Clasificación de comprobantes (GVA81).

**Preguntas para Axoft/TC con la respuesta del lunes 2026-09-01:**

1. Confirmar que lo que habilitan es "Transacciones Tango Ventas" sobre la llave 001174 (y costo/fecha).
2. ¿El pedido creado por API entra al circuito que necesitan (pedido → facturador → remito que
   descarga del depósito-camión)? ¿`ID_STA22` por camión-depósito alcanza para la descarga?
3. ¿Qué talonario (`ID_GVA43_TALON_PED`) usar para los pedidos que vienen de la app?
4. ¿Las DOS empresas (Redonhielo/Rolito) = dos valores del header `Company`? ¿El token sirve para ambas?
5. ¿`ESTADO: 2` (ingresa aprobado) o circuito de aprobación?
6. ¿Hay fecha para la API de "Facturación de Ventas" (hoy "próximamente" en el repo oficial)?

## 7. Material pendiente de recopilar (Ariel)

- [ ] Export Excel de **clientes** de Tango (código, razón social, CUIT, lista de precios, vendedor, condición de venta, categoría IVA) — alcanza una muestra.
- [ ] Export Excel de **artículos** (código, descripción, unidades de medida).
- [ ] Export de **listas de precios** (números y nombres de lista + precios).
- [ ] Capturas de pantalla: ABM cliente, ABM artículo, carga de pedido, factura.
- [ ] Circuito contado por quien opera: cómo entra un pedido hoy, cómo se factura, qué pasa al cancelar.
- [ ] Respuestas de Silvina (preguntas 1-2 de §6).
- [ ] Manuales/PDFs que tenga el implementador sobre la extensión API.

> Dejá todo en `docs/tango/material/` (crear la carpeta al primer archivo) y avisá — se procesa y se vuelca acá.

## 8. Producción → Tango en tiempo real (Fase A, 2026-08-27)

Replanteo de objetivo (conversación 2026-08-27): la idea original de empujar
ediciones de clientes app→Tango se descartó — esos campos ya son "propiedad"
de Tango vía la sync diaria de §6.1 (pisarlos de vuelta generaría loops). El
caso real es **producción de hielo**: antes se cargaba con una app llamada
Bluesoft (dada de baja); hoy el personal de planta anota en planillas de papel
y un administrativo teclea eso a mano en Tango. Rolito ya tiene el reemplazo
de Bluesoft construido — `ProduccionDashboard.tsx` (ruta `/produccion`,
colección `produccionPallets`) — falta que esa carga viaje sola a Tango.

**Bloqueo pendiente (no resuelto por este trabajo):** no sabemos todavía qué
proceso/pantalla de Tango usa el administrativo para cargar producción, ni si
está expuesto por la API de Plataforma/ABM (como Clientes) o requiere otro
módulo. Ver pregunta abierta 7 en §6. Hasta confirmarlo, el envío real a
Tango queda como un stub explícito (ver abajo) — no se escribió nada
especulativo contra un endpoint que todavía no confirmamos que existe.

### Arquitectura implementada

```
produccionPallets/{id} (onCreate, Cloud Function)
        │
        ▼
tango-outbox/{id}  (estado: pendiente → enviado → confirmado/error)
        │  onSnapshot en tiempo real (SDK cliente, no Admin SDK)
        ▼
scripts/tango/bridge-listener.mjs  (servicio de Windows en la VM de Tango)
        │
        ▼
enviarProduccionATango()  ← STUB, pendiente de confirmar el proceso Tango
```

- **`tango-outbox`** (Firestore): cola genérica, pensada para reusarse en
  futuros casos, no solo producción. Un doc por evento, ID determinístico
  (`produccionPallets_{palletId}`) para que un reintento del trigger no
  duplique el envío.
- **Trigger** `functions/src/triggers/tangoOutbox.ts` (`onProduccionPalletCreado`):
  `onDocumentCreated('produccionPallets/{palletId}')` → un `tango-outbox`.
  `produccionPallets` es inmutable (firestore.rules), así que `onCreate` es
  el único evento que hace falta.
- **Credencial acotada del bridge**: en vez de un rol nuevo en `UserRole`
  (que tocaría navegación/rutas de toda la app para una cuenta que nunca
  hace login por la UI), es un flag booleano propio: `users/{uid}.tangoBridge
  = true`, reconocido por `isTangoBridge()` en `firestore.rules`. Cuenta real
  de Firebase Auth creada una vez con `scripts/tango/setup-bridge-account.mjs`.
  Reglas: puede leer/escuchar `tango-outbox` y actualizar solo sus campos de
  estado (`estado`, `intentos`, `ultimoError`, `actualizadoEn`) — nunca el
  `payload` ni el origen. También puede leer y actualizar (solo su propio
  heartbeat) `config/tango`.
- **`scripts/tango/bridge-listener.mjs`**: corre en la misma VM que
  `bridge-sync-clientes.mjs`, pero como **servicio de Windows persistente**
  (NSSM), no tarea diaria — usa el SDK **cliente** de Firestore (nunca
  Admin SDK: coherente con la decisión de agosto de que el bridge nunca
  tiene la clave maestra), `onSnapshot` sobre `tango-outbox` donde
  `estado=='pendiente'` (cero polling para trabajo nuevo). Gateado además por
  un flag propio y separado del de clientes: `config/tango.produccionEnabled`
  (default `false`).
- **Retry/backoff — ojo con este detalle:** un item que falla NO vuelve a
  `estado:'pendiente'` (eso dispararía un reintento instantáneo sin backoff,
  porque el listener en tiempo real escucha justo ese estado — se probó y
  reprodujo este bug contra el emulador antes de corregirlo). Pasa a
  `estado:'enviado'` (fuera del query del listener) y un barrido cada 5 min
  es el único que lo reintenta — eso ES el backoff. Tras `MAX_INTENTOS=5`
  pasa a `estado:'error'` (terminal, revisión manual).
- **`enviarProduccionATango()`** (dentro de `bridge-listener.mjs`): stub
  explícito — solo loguea el payload que mandaría y devuelve un error
  controlado. Es la única función que hay que completar una vez confirmado
  el proceso Tango (pregunta abierta 7, §6).

### Verificado (2026-08-27)

`npm run test:rules` (reglas nuevas de `tango-outbox` y `config/tango` para
`isTangoBridge()`) y flujo end-to-end contra el emulador (Firestore+Auth):
alta de item → recogido por el listener en tiempo real → stub invocado →
backoff correcto entre reintentos → `estado:'error'` a los 5 intentos. No se
probó contra el Tango real (el stub no llama a nada real todavía).

### Fuera de alcance de esta fase

- Tango → app en tiempo real (requiere SQL Server Change Data Capture en el
  servidor de Tango — administrado por TC Servicios Informáticos, acceso
  pendiente).
- Completar `enviarProduccionATango()` con el proceso Tango real (pregunta
  abierta 7, §6).
- Panel `/admin/tango` de monitoreo (§4 punto 6) — no pedido todavía; por
  ahora la única visibilidad es `config/tango.bridgeListenerLastSeen`
  (heartbeat) y los estados de los docs de `tango-outbox`.
