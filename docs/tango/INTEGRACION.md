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

**CONFIRMADO (2026-08-25; re-verificado 2026-08-31 sin cambios tras la reunión con Tango/TC), directo del servidor productivo — Datos de licencia → solapa "API (Apertura)":**

| Ítem | Habilitada |
|---|---|
| ABMs y consultas Live | **Sí** |
| Transacciones Tango Ventas | **No** |
| Transacciones Tango Contabilidad | **No** |

Esto confirma dos cosas: (1) la API de **Plataforma/ABM** (Clientes, Proveedores, Artículos, Cuentas de tesorería — GET/POST/PUT/DELETE) está activa y lista para usar — es API distinta de Tango Tiendas, ya no es una incógnita. (2) **No está licenciada la escritura de pedidos/facturas** por esta vía (Transacciones Ventas = No) — el plan de "la app crea el pedido y lo sube a Tango" necesita, para ESTE camino, contratar ese módulo aparte a Axoft, o bien resolverse por la API de Tango Tiendas (licencia distinta, todavía sin confirmar). **Alcance inmediato desbloqueado sin costo adicional:** sincronizar clientes/artículos/stock (lectura y escritura de maestros) vía ABM API.

**Módulos instalados en la llave (2026-08-31, captura de Ariel — Datos de licencia → solapa "Módulos"; llave `001174/003`, licencia 896437, GOLD, 15 terminales, estado Ok, instalación 20/08/2026, tipo "Virtual HL"):**

| Módulo | Código |
|---|---|
| Procesos generales | 11 |
| Administrador | 51 |
| Contabilidad Astor | 6 |
| Sueldos Astor | 8 |
| Control de personal | 9 |
| **Tesorería** | 10005 |
| Aplicaciones Nexo | 10026 |
| **Stock** | 10002 |
| Compras | 10003 |
| **Central** | 10010 |
| Cash Flow | 10006 |
| **Ventas** | 10023 |

Lectura relevante para la integración: **Tesorería (10005) y Ventas (10023) están instalados como módulos** — o sea que los recibos de cobranza y el circuito de facturación existen en el Tango; lo que falta no son módulos sino el flag de licencia de la **API de transacciones** (solapa "API (Apertura)": Transacciones Tango Ventas = No al 25/08). Central (10010) también está — mantiene abierta la vía "transferencia de comprobantes" como plan C. En la UI web de Delta 6 el camino es: lupa → "Datos de licencia" (o Administrador → Datos de licencia), solapas Principal / Módulos / Funcionalidad opcional / **API (Apertura)** / Licencias de Sueldos.

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
- **Auth (headers en cada request):** `ApiAuthorization` (el token de desarrollador) + `Company` (número de empresa: **`1` = REDONHIELO SA, `3` = ROLITO**, confirmado 2026-09-02).
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

### 6.1 bis — API de Consultas Live ("Apertura") — relevada 2026-08-31, EN VIVO desde el server

Descubierta por Ariel en la pantalla **Ventas → Consultas → Clientes → Saldos → Apertura**
(la composición de saldos para las cobranzas de supervisores). Las consultas Live tienen
**endpoints propios**, distintos del `Api/Get?process=` de los ABMs:

- **Auth:** mismos headers de siempre — `ApiAuthorization` (el token de desarrollador ya
  generado) + `Company` (1 = Redonhielo). La pantalla de Apertura los muestra precargados.
- `GET Api/GetColumnDefinition/{process}/{sortAlphabetically}` — **definición de columnas**
  de la consulta: permite descubrir el esquema programáticamente, sin adivinar campos.
- `GET Api/GetApiLiveQueryData/{process}/{fromDate}/{toDate}/{pageSize}/{pageIndex}/{customQuery}`
  — la consulta paginada (parámetros en el PATH, no query string), con rango de fechas y
  filtro `customQuery`.
- `POST Api/GetApiLiveFullOpenData` — consulta Live con parámetros en el body.

**Consultas Live relevadas y PROBADAS contra el server real (2026-08-31, sesión RDP de Ariel):**

| process | Consulta | Qué devuelve |
|---|---|---|
| **12205** | "Saldos" (Ventas → Consultas → Clientes → Saldos) | Una fila por CLIENTE con `saldO_CTE`/`saldO_EXT` (totales, sin composición) + datos de contacto |
| **17953** | **"Deudas vencidas"** (Ventas → Consultas → Cuenta Corriente) | **LA COMPOSICIÓN**: una fila por comprobante pendiente vencido |
| **17955** | **"Deudas a vencer"** (mismo menú) | La otra mitad: comprobantes pendientes no vencidos (confirmado 2026-08-31, misma estructura que 17953) |
| **17943** | **"Detalle de comprobantes"** (Ventas → Consultas → Facturación) | **LOS RENGLONES**: una fila por artículo facturado (ver §10) |

**Formato REAL del GetApiLiveQueryData (probado con datos, difiere de la plantilla de la Apertura):**

```
GET /Api/GetApiLiveQueryData?process=17953&customQuery=0&fromDate=01/01/2020&toDate=31/12/2026&pageSize=3&pageIndex=0
Headers: ApiAuthorization + Company
```

- Parámetros por **query string** (la plantilla `/{process}/...` de la pantalla de Apertura NO funciona — devuelve el HTML de la app, mismo caso que el ABM).
- `customQuery=0` obligatorio (no acepta vacío, ni espacios, ni `1=1`, ni `false` — es un flag numérico).
- Fechas en **dd/MM/yyyy** (con `yyyy-MM-dd` tira "String was not recognized as a valid DateTime").
- Respuesta: `{ resultData: { list, pageIndex, pageSize, totalCount, totalPages, ... }, succeeded }` — mismo sobre que el ABM.
- `GetColumnDefinition?process=N&sortAlphabetically=false` sí es query string y devuelve el esquema completo.

**Fila real de 17953 (campos confirmados):** `ID_GVA12` (ID interno del comprobante en cta. cte. — para imputar), `FECHA_DE_VENCIMIENTO` (ISO), `TIPO_COMPROBANTE` ('FAC'), `NRO_COMPROBANTE` ('A0010100173697'), **`ID_GVA14`** (¡el vínculo directo con `users/{uid}.idGva14Tango`!), `CLIENTE` ("ACH082 - HANZA MARIA ELENA" — código alfanumérico histórico + razón social), `NOMBRE_PROVINCIA`, `IMPORTE_AL_VENCIMIENTO_CTE`, `IMPORTE_PENDIENTE_CTE` (el saldo restante — los cobros parciales se ven: 1028.50 → pendiente 150.50), `DIAS_DE_ATRASO`, `ID_GVA23`/`COD_VENDEDOR`. Nota: la respuesta trae las columnas del diseño por defecto de la consulta (no las ~55 del GetColumnDefinition); `FECHA_DE_EMISION` no viene en el default. 1.022 deudas vencidas al 2026-08-31.

**Pendiente inmediato:** con el process ya conocido: primero `GetColumnDefinition` para el esquema, después
ajustar `scripts/tango/bridge-sync-saldos.mjs` y el handler de consultas de
`bridge-listener.mjs` (hoy asumen el formato ABM `Api/Get`/`GetByFilter` — hay que
migrarlos a `GetApiLiveQueryData`). Esto corre con la licencia ACTUAL ("ABMs y consultas
Live: Sí") — no depende de Axoft.

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

**Procesos relacionados — RESUELTOS (2026-09-01), no hace falta relevarlos por RDP.** Están
hardcodeados en el código C# oficial (constante `ProcessId` de cada `*Services.cs` en
`github.com/TangoSoftware/TangoDeltaApi/src/CommonServices/`):

| `process` | Tabla | Campo del pedido que resuelve |
|---|---|---|
| **87** | Artículos (STA11) | `RENGLON_DTO[].ID_STA11` |
| **2941** | Depósitos (STA22) | `ID_STA22` — **los camiones** |
| **2497** | Condiciones de venta (GVA01) | `ID_GVA01` |
| **984** | Listas de precios (GVA10) | `ID_GVA10` |
| **952** | Vendedores (GVA23) | `ID_GVA23` |
| **960** | Transportes (GVA24) | `ID_GVA24` |
| **1660** | Monedas | `ID_MONEDA` |
| **326** | Clasificación de comprobantes (GVA81) | `ID_GVA81` |
| 2117 | Clientes (GVA14) | `ID_GVA14` — ya confirmado en vivo (2026-08-25) |
| 19845 | Pedidos (GVA21) | el `Api/Create` del pedido |

> **Por qué confiar en esta lista sin haberla probado:** dos de sus valores (Clientes=2117 y
> Pedidos=19845) ya estaban confirmados contra el server real por vías independientes, y ambos
> coinciden con lo que dice el código oficial. Eso valida la fuente.

**Sigue pendiente de relevar por RDP: Talonarios (GVA43)** → `ID_GVA43_TALON_PED`. No hay un
servicio de talonarios en el repo oficial, así que ese `process` hay que sacarlo de la pantalla
(Apertura > API) o preguntarlo. Es el único dato de tabla que falta para armar el pedido.

**Herramientas ya escritas para bajar todo esto (2026-09-01):**
- `scripts/tango/export-tablas-tango.ps1` — corre en el server, baja las 8 tablas de arriba a
  `Escritorio\tango-tablas\*.json` (una pasada, mismo patrón que `export-clientes-tango.ps1`,
  incluido el armado del `$uri` por concatenación para esquivar el bug del parser de PowerShell).
- `scripts/tango/cruce-articulos.mjs` — empareja `config/catalogo` (11 productos) contra los
  artículos de Tango y propone candidatos con nivel de confianza. **No escribe nada**: a
  diferencia del cruce de clientes (que tenía el CUIT como clave dura), acá el emparejamiento es
  por nombre y necesita confirmación humana. Puntúa por familia (hielo/agua/insumo) + magnitud
  (2/3/10 kg, 1/6 l) + solapamiento de palabras; un choque de magnitud o familia hunde el
  puntaje. Validado contra un set de prueba con señuelos ("BOLSA POLIETILENO 2 KG VACIA" quedó
  en 42 vs 88 del artículo correcto).

**Preguntas para Axoft/TC con la respuesta del lunes 2026-09-01:**

1. Confirmar que lo que habilitan es "Transacciones Tango Ventas" sobre la llave 001174 (y costo/fecha).
2. ¿El pedido creado por API entra al circuito que necesitan (pedido → facturador → remito que
   descarga del depósito-camión)? ¿`ID_STA22` por camión-depósito alcanza para la descarga?
3. ¿Qué talonario (`ID_GVA43_TALON_PED`) usar para los pedidos que vienen de la app?
4. ~~¿Las DOS empresas (Redonhielo/Rolito) = dos valores del header `Company`?~~ **RESUELTO
   (2026-09-02): sí — `Company: 1` = REDONHIELO SA, `Company: 3` = ROLITO.** El número sale de la
   URL de la app web: al elegir la empresa en el selector de Tango queda en
   `rhielotg:17000/company/{N}/…`. Ojo que no siguen el orden de la lista del selector ("Empresa
   Ejemplo" aparece primera y Rolito es la 3). **Falta confirmar si el token de desarrollador sirve
   para las dos** — se prueba repitiendo cualquier consulta con `Company: 3`.
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

## 9. Cobranzas de supervisores: composición de saldos + recibos (Fase B, 2026-08-31)

Feature nueva del lado app (plan completo aprobado por Ariel — rol `supervisor`
que cobra cta. cte. en la calle con imputación de facturas, cheques y
retenciones). Lo relevante para ESTA integración:

**Lectura de saldos (Tango → app), dos canales que ya están codeados:**
- **Cache periódico:** `scripts/tango/bridge-sync-saldos.mjs` (Task Scheduler
  cada 1-2 h en la VM) → Cloud Function `syncSaldosTango`
  (`functions/src/triggers/tangoSaldos.ts`, mismo patrón/secret que
  `syncClientesTango`, gates `config/tango.enabled` + `saldosEnabled`) →
  colección `saldosTango/{uid}`. El snapshot es completo por corrida (`runId`):
  el último lote vacía los docs de clientes que ya no deben nada.
- **Refresh on-demand:** cola inversa `tango-consultas` (la pantalla de cobro
  crea un doc `tipo:'saldoCliente'`; `bridge-listener.mjs` lo responde vía
  `Api/GetByFilter` con `ID_GVA14 = n` y gate `consultasEnabled`; la Function
  `onConsultaRespondida` copia el resultado al cache). Timeout de 12 s en la
  UI → cae al cache con etiqueta "actualizado hace X".

**⚠ PENDIENTE DE RELEVAR (bloquea la conexión real, no el código):** el
`process`/vista de la **composición de saldos** en el server (pararse en la
pantalla de la consulta Live → "Apertura > API"). Es LECTURA, así que debería
estar cubierto por "ABMs y Consultas Live: Sí" ya licenciado. Los nombres de
campo en `recortarComprobante()`/`recortarSaldo()` (en ambos scripts) son
tentativos — ajustarlos al relevar. Config: `bridge-sync-saldos.config.json`
y la sección `tangoSaldos` de `bridge-listener.config.json`.

**Escritura de recibos (app → Tango):** `onCobranzaCreada` encola
`entidad:'recibo'` en `tango-outbox` (payload con `imputaciones[]`, `medios`
—cheques con banco/fechas/días, retenciones—, `numeroRecibo` interno
`RS-000123` y `referenciaIdempotente: ROLITO:{cobranzaId}`).
`bridge-listener.mjs` ahora es un **dispatcher por entidad**
(`produccionPallet`/`remito`/`recibo`, cada una con su flag en `config/tango`);
`enviarReciboATango()` es **stub** hasta que Axoft habilite "Transacciones
Tango Ventas" (respuesta esperada 2026-09-01) y se releve el process de
recibos. Al implementarlo es OBLIGATORIO el anti-duplicado: `GetByFilter`
previo por la referencia idempotente antes del `Create` (cubre el gap
"Create OK → bridge muere → barrido reintenta"), y persistir `SavedId` en
`resultado` inmediatamente.

**Descuento optimista:** mientras el writer no exista, `onCobranzaCreada`
descuenta lo imputado del cache `saldosTango` en el momento, y tanto el sync
periódico como la consulta on-demand **re-aplican** los descuentos de
cobranzas con `tango.estado != 'confirmado'` (ventana 90 días) para no
resucitar deuda ya cobrada. Cuando Tango confirme el recibo, su propia
composición ya lo refleja y la cobranza deja de restarse sola.

**Flags nuevos en `config/tango`:** `saldosEnabled`, `consultasEnabled`,
`remitosEnabled`, `recibosEnabled` (todos default false; `produccionEnabled`
ya existía).

## 10. Recupero de las facturas viejas de Bluesoft (2026-09-01)

Las facturas emitidas hasta el **20/08/2026** que siguen impagas se perdieron en el
formato PDF con el que las mandaba Bluesoft. Los datos están en Tango; lo que se
rehace es la impresión. **Es una corrida puntual, no una función de la app:** son
REIMPRESIONES de comprobantes ya autorizados, así que jamás se pide un CAE nuevo.

### Qué se construyó

| Archivo | Qué hace |
|---|---|
| `src/utils/facturaPdf.ts` | El layout de la factura A: réplica del comprobante de Bluesoft (relevado de la 00101-00282302), con el QR de la RG 4892 y el código de barras I25 del pie. Corre igual en el browser y en Node. |
| `src/utils/facturaPdf.test.ts` | Importe en letras, composición de los 40 dígitos del barcode + su DV, y el JSON del QR. |
| `scripts/tango/generar-facturas-pdf.mjs` | Toma un JSON de facturas y escribe un PDF por comprobante. Rechaza las que vengan sin CAE. |
| `scripts/tango/relevar-facturas-tango.ps1` | El relevamiento de la consulta (ya cumplió su función, queda por si hace falta otra). |
| `public/marca-agua-factura.jpg`, `public/logo-rolito-factura.png` | Las imágenes del comprobante, reducidas para impresión (con los originales cada PDF pesaba 3,4 MB; ahora 84 KB). |

### La consulta 17943 — "Detalle de comprobantes"

`Ventas → Consultas → Facturación → Detalle de comprobantes` (`/company/1/live/17943`).
Es la que tiene **el detalle renglón por renglón**, que la composición de saldos no trae.

**Fila real confirmada (2026-09-01):**

```json
{
  "FECHA_DE_EMISION": "2026-08-19T00:00:00",
  "TIPO_COMPROBANTE": "FAC",
  "NRO_COMPROBANTE": "A0020300000121",
  "NOMBRE_VENDEDOR": "NICOLAS DIAZ",
  "RAZON_SOCIAL": "ALVAREZ MARIA CONSTANZA",
  "ID_GVA14": 9733,
  "COD_ARTICULO": "PTHIBOLROLI0003",
  "DESCRIPCION": "HIELO EN BOLSA ROLITO 3 KG",
  "CANTIDAD": 30,
  "TOTAL": 48000,
  "ID_GVA12": 371572,
  "ID_GVA23": 9762, "ID_GVA38": null, "ID_STA11": 1466
}
```

88 renglones para un solo día (19/08). Notar:

- **`ID_GVA12` es el mismo identificador que devuelven 17953/17955**, así que los
  renglones se cruzan con la composición de saldos sin ambigüedad: de ahí salen el
  total del comprobante, el vencimiento y el saldo pendiente.
- **No viene el precio unitario**: se deriva `TOTAL / CANTIDAD` (48000/30 = 1600).
- **El punto de venta no es uno solo** (`A00203…` acá, `A00101…` en la factura de
  muestra): el generador lo toma del número de comprobante, no lo fija.
- El `GetColumnDefinition` devuelve 71 columnas identificadas por id numérico, no por
  nombre — la respuesta trae solo las del diseño por defecto, como en 17953.

### El CAE: no está en 17943

La **Ficha Live de facturas, créditos y débitos** no es una consulta Live sino un
dashboard (`/company/1/dashboard/14077`), y su Apertura expone un solo endpoint:

```
GET Api/GetPdf/{process}/{id}
```

Es decir, Tango devuelve el PDF de un comprobante por API — pero con **su** diseño, no
con el de Bluesoft, así que no reemplaza al generador. Queda anotado por si sirve para
otra cosa (verificar contra el original, por ejemplo).

**Plan para el CAE:** traerlo de ARCA con `FECompConsultar`, que ya está implementado y
probado contra producción (`functions/src/services/arca/wsfev1.ts`). Una llamada por
comprobante, con throttle; para ~1.000 facturas es perfectamente viable y de paso
verifica que el importe de Tango coincide con lo que ARCA tiene registrado. Requiere el
certificado del CUIT que emitió cada factura (hoy está el de Redonhielo, 30-69766897-3).

### El camino que quedó: parsear el PDF "en blanco" de Tango

Antes de armar el export por API apareció una vía mejor. Tango imprime las facturas
en un PDF **"en blanco"** — el que se tiraba sobre formulario preimpreso: trae los
datos, no el diseño. Y ese PDF tiene **todo lo que la API no daba**: precio unitario,
CUIT, domicilio, condición de venta y el remito.

`scripts/tango/parsear-facturas-tango.mjs` lo lee con `pdfjs-dist` y arma el JSON de
entrada del generador. El formulario tiene posiciones fijas, así que cada dato se ubica
por su banda de Y y su rango de X (en mm) — las constantes `CAMPOS` y `COLS` del script.

Verificado contra `00101-00281898` (13/08/2026, PAN AMERICAN ENERGY): los tres renglones
suman el neto y neto + IVA da el total, y el importe en letras que calcula
`importeEnLetras` coincide palabra por palabra con el que imprime Tango
("CIENTO SIETE MIL CUATROCIENTOS NOVENTA Y SEIS CON 40/100"). El script hace ese control
aritmético en cada factura y avisa si no cierra.

**Lo único que el PDF de Tango NO trae es el CAE.** Se completa con `--caes archivo.json`,
un mapa `"00101-00281898" → { cae, caeVto }` que sale de la consulta con la columna
`C.A.I. / C.A.E.` agregada desde Configurar → Columnas y exportada a Excel. Sin CAE la
factura se escribe igual en el JSON pero con `cae: ""`, y el generador la rechaza: mejor
que falte a que salga un comprobante sin su autorización.

### Por qué el CAE no sale por API

La consulta 17943 devuelve **siempre las columnas de su diseño base**, sin importar lo que
se configure en pantalla. Comprobado con las dos vías:

- `GET Api/GetApiLiveQueryData?process=17943&…` → los mismos 14 campos.
- `POST Api/GetApiLiveFullOpenData` con el mismo process → idénticos 14 campos.

El campo existe (`C.A.I. / C.A.E.` figura en Configurar → Columnas), pero agregarlo a la
grilla no cambia lo que responde la API. Falta probar guardarlo en **"Mis consultas"**,
que le asignaría un process propio a la consulta con las columnas elegidas.

### La pantalla: `/admin/recupero-facturas`

El recupero terminó siendo una pantalla y no un script, por una razón operativa: el
CAE lo carga a mano quien lo está mirando en Tango, y conviene ver los datos leídos
**antes** de generar. Roles `super_admin` y `facturacion`.

| Archivo | Qué hace |
|---|---|
| `src/utils/parsePdf.ts` → `extractPdfItems` | Texto CON coordenadas (mm). El resto del módulo devuelve texto corrido, que acá no sirve. |
| `src/utils/facturaTango.ts` | El parser del formulario + `verificarFactura` (control aritmético). |
| `src/utils/facturaTango.test.ts` | 10 casos sobre los items reales de la 00101-00281898. |
| `src/pages/admin/RecuperoFacturasPage.tsx` | La pantalla: drop de PDF, campos de CAE, generar. |

Todo corre en el navegador del administrativo: los PDF no se suben a ningún lado y no
tocan Firestore ni Storage.

**Es una campaña puntual.** Cuando el recupero termine se borran la página, su ruta en
`App.tsx` y los dos accesos (Navbar de `facturacion` y BackofficeHome). El generador
(`facturaPdf.ts`) se queda: lo va a necesitar la facturación con ARCA.

También quedaron los scripts de línea de comandos, por si conviene hacerlo en lote:
`parsear-facturas-tango.mjs` (PDF → JSON) y `generar-facturas-pdf.mjs` (JSON → PDF).

### Escalas distintas del mismo formulario (2026-09-02)

La misma factura se leía con un usuario de Tango y fallaba con otro. Comparando dos
PDF reales: el segundo viene **al 94% en vertical y al 83% en horizontal** — cada eje
estirado distinto, lo típico de un formulario de papel continuo impreso "ajustado a
la página" en A4. Depende de la configuración de impresión del usuario que lo baja.

Como cada dato se ubicaba por su posición en mm, en ese PDF no se encontraba nada.
La solución no fue ensanchar las bandas (con estiramientos distintos por eje no
alcanza): `normalizarEscala` deduce la transformación con textos FIJOS del formulario
(`PESOS`, `VENDEDOR:`, la leyenda de los cheques, el número de comprobante), ajusta
por mínimos cuadrados la recta `real = a·referencia + b` de cada eje y lleva las
coordenadas a la escala de referencia. El resto del parser no se entera, y un PDF que
ya venga en esa escala queda igual (transformación identidad).

Los dos PDF están como fixtures en `facturaTango.test.ts` con sus datos reales.

### Estado: terminado (2026-09-02)

En producción y en uso. **Decisión de Ariel: no se automatiza más.** Los CAE se cargan
a mano, factura por factura, y se van mandando a los clientes a medida que se generan
— no es un trabajo prioritario y no justifica más herramientas.

Quedó **sin construir** a propósito (por si alguna vez cambia la prioridad): la carga
masiva de CAE desde el Excel que exporta la consulta con la columna `C.A.I. / C.A.E.`,
que evitaría tipear 100-200 números de 14 dígitos.

El corte de fecha quedó sin definir (se habló de 20/8 y de 28/8); en la práctica no
hizo falta, porque las facturas se procesan de a una a medida que se necesitan.

---

## 12. Preparado para el día que llegue la API de Ventas (2026-09-02)

Con la facturación contra ARCA ya en producción, el outbox pasó a decidir **qué comprobante** y
**en qué empresa** va cada venta, en vez de mandar todo como remito. La regla es
`destinoTango(canal, formaPago, total)` en `functions/src/services/arca/circuito.ts` — la **misma**
que decide si se le pide un CAE a ARCA, para que no puedan divergir:

| Venta | entidad | empresa | `conCaePropio` |
|---|---|---|---|
| contado efectivo / transferencia | `factura` | Redonhielo | **sí** |
| contado cuenta corriente | `remito` | Redonhielo | no |
| promo efectivo / transferencia | `factura` | Rolito | no |
| promo cuenta corriente | `remito` | Rolito | no |
| solo cambios (total 0), cualquier canal | `remito` | según canal | no |

Cada item de `tango-outbox` lleva `empresa` (la del NEGOCIO, no el número de la API) y
`conCaePropio`, y el writer recibe el item entero (`handler.enviar(payload, item)`), no solo el
payload.

### El número de `Company` se resuelve al mandar, contra `config/tango.companies`

El 2026-09-02 se creó en Tango la empresa **TestingRH** para probar contra ella antes de tocar las
reales. Por eso el número NO está en el código: el bridge lo resuelve en el momento del envío.

```
config/tango.companies = { "redonhielo": N, "rolito": N }   ← las dos a TestingRH mientras se prueba
config/tango.companies = { "redonhielo": 1, "rolito": 3 }   ← producción
```

Pasar de pruebas a producción es cambiar ese doc: sin tocar código, sin redeploy. **Si falta el
número de una empresa, el item NO se manda** y queda con el error escrito — mandar un comprobante a
la empresa equivocada se limpia a mano del otro lado.

El número de cada empresa sale de la URL de Tango: `/company/{N}/`. Redonhielo = 1, Rolito = 3;
el de TestingRH hay que mirarlo (el orden del selector NO es el de los números).

### La pregunta que hay que hacerle a Axoft ANTES de completar el writer

> **¿La API permite registrar un comprobante con un CAE ya obtenido por afuera, sin que Tango le
> pida el suyo a ARCA?**

Las facturas de contado **ya vienen autorizadas**: las emitió la app con el punto de venta 1104, y
el CAE viaja en `payload.factura` (`puntoVenta`, `numero`, `cbteTipo`, `cae`, `caeFchVto`,
`importes` tal como se le informaron a ARCA). Si el writer usara un proceso que pide CAE propio, la
misma operación quedaría **autorizada dos veces** — dos comprobantes fiscales por una sola venta,
que después hay que anular con notas de crédito.

Si la API no lo admite, **no completar el writer igual**: hay que replantear quién factura.

### Orden de emisión, que importa

`onVentaCamionCreada` NO encola las facturas de Redonhielo: cuando la venta se crea, el CAE
todavía no existe (lo escribe `onVentaContadoFacturar` unos segundos después). Esas las encola
`onVentaCamionFacturada`, que dispara con el paso de `factura.estado` a `emitida`. Los dos usan el
**mismo id de outbox** (`ventasCamion_{ventaId}`), así que una venta produce **un solo**
comprobante en Tango: nunca un remito y una factura por la misma operación.

### Lo que queda por hacer cuando llegue la API

Tres funciones en `scripts/tango/bridge-listener.mjs`, hoy stubs que solo loguean el payload:
`enviarFacturaATango`, `enviarRemitoATango`, `enviarProduccionATango` (y `enviarReciboATango` para
cobranzas). Cada una tiene su interruptor propio en `config/tango`
(`facturasEnabled`, `remitosEnabled`, `produccionEnabled`, `recibosEnabled`), así se puede habilitar
una sin las otras. El resto de la máquina —cola idempotente, reintentos, barrido, write-back del
número de comprobante al doc de origen— ya está y no se toca.
