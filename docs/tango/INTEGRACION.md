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
- [ ] Respuesta de Axoft sobre transferencias entre depósitos por API (§13) — bloquea el remito de carga y la descarga en Tango.

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
| promo efectivo / transferencia | `factura` (X) | Rolito | no |
| promo cuenta corriente | `factura` (X, con `cuotasCuentaCorriente` en el Facturador) — **cambio 2026-09-03**, antes iba como remito/pedido | Rolito | no |
| solo cambios (total 0), cualquier canal | `remito` | según canal | no |

> **2026-09-03:** Ariel decidió que la promo en cuenta corriente también es factura X (no remito):
> en Tango entra por el Facturador como FAC X con cuota de cta. cte. `config/tango.facturador.rolito.condicionVenta`
> admite `{ contado, cuenta_corriente }` para mandar la condición de venta correcta. El pedido
> (§14) queda para el remito de contado en cuenta corriente (Redonhielo) y las operaciones en $0.

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

> **RESPONDIDA por la doc oficial (2026-09-03):** el Facturador
> (`src/CommonServices/ventas/comprobantesregistracion`, `ProcessId = 20412`, endpoint
> `POST http://rhielotg:17000/FacturadorVenta/registrar`, body = array de comprobantes) tiene el
> ejemplo **"05 - Factura - Comprobante Electrónico"**: el encabezado lleva `cAE` (obligatorio, 14
> chars) y `fechaVtoCAE` **puestos por quien llama** — Tango registra el comprobante ya autorizado,
> no pide CAE propio. Trabaja por **códigos** (no IDs): `codigoCliente` (COD_GVA14),
> `codigoTalonario`, `codigoDeposito` (2 chars), `codigoVendedor`, `codigoCondicionDeVenta`,
> `codigoListaPrecio`, `codigoContracuenta`, ítems con `codigo` (COD_STA11), `codigoTasaIva`,
> `cantidad`, `precio`, `importe`, `importeSinImpuestos`, `importeIva`; totales
> (`total`, `totalSinImpuestos`, `totalIva`, `subtotal`, `subtotalSinImpuestos`) y `pagos[]`
> (`tipo: Efectivo|…`, `codigoDeCuenta`, `monto`). `numeroComprobante` = letra + pto vta (5) +
> número (8), ej. `A1752800000106`. Respuesta `{ Message, Comprobantes[{numeroComprobante, estado,
> mensaje}], Succeeded }`; el error `(51016) Ya existe el número de comprobante` sirve de
> idempotencia natural. También expone acceso por **Tango Connect**
> (`http://{llave}.connect.axoft.com/Api/FacturadorVenta/registrar`). Solo FAC/NC/ND — no remitos.
> Esto habilita completar `enviarFacturaATango`; faltan los códigos de talonario, contracuenta,
> cuenta de tesorería (efectivo/transferencia), lista y tasa de IVA de Redonhielo.

### Orden de emisión, que importa

`onVentaCamionCreada` NO encola las facturas de Redonhielo: cuando la venta se crea, el CAE
todavía no existe (lo escribe `onVentaContadoFacturar` unos segundos después). Esas las encola
`onVentaCamionFacturada`, que dispara con el paso de `factura.estado` a `emitida`. Los dos usan el
**mismo id de outbox** (`ventasCamion_{ventaId}`), así que una venta produce **un solo**
comprobante en Tango: nunca un remito y una factura por la misma operación.

### Lo que queda por hacer cuando llegue la API

> **2026-09-03:** `enviarRemitoATango` ya es real (pedido en Tango, ver §14). Siguen como stubs
> `enviarFacturaATango`, `enviarProduccionATango`, `enviarReciboATango` y `enviarTransferenciaATango`.

Funciones en `scripts/tango/bridge-listener.mjs` que eran stubs que solo logueaban el payload:
`enviarFacturaATango`, `enviarRemitoATango`, `enviarProduccionATango` (y `enviarReciboATango` para
cobranzas). Cada una tiene su interruptor propio en `config/tango`
(`facturasEnabled`, `remitosEnabled`, `produccionEnabled`, `recibosEnabled`), así se puede habilitar
una sin las otras. El resto de la máquina —cola idempotente, reintentos, barrido, write-back del
número de comprobante al doc de origen— ya está y no se toca.

## 13. Transferencias de depósito: remito de carga y descarga del camión (2026-09-03)

Decidido con Ariel el 2026-09-03. El remito de carga (`remitosCarga`) nacía con
`tango.estado = 'pendiente'` y ningún trigger lo mandaba: no es un remito de venta (ninguna API de
ventas lo crea) sino una **transferencia de stock planta → camión**. En Tango los camiones son
depósitos (`STA22`, §6.2) y la venta desde el camión descarga stock de ese depósito: para que
cierre, la mercadería tiene que haber entrado antes. La **descarga contada** al volver
(`descargasCamion`) es el movimiento inverso, camión → planta; sin ella el depósito-camión nunca
vuelve a cero.

Implementado:

- `onRemitoCargaCreado` y `onDescargaCamionCreada` (`triggers/tangoOutbox.ts`) encolan un item
  `entidad: 'transferenciaDeposito'`, `empresa: 'redonhielo'`, con `payload.sentido` = `'carga'` |
  `'descarga'` y el detalle de ítems/pallets. Ids `remitosCarga_{id}` / `descargasCamion_{id}`.
- Write-back al confirmarse: `tango: { estado: 'confirmado', transferenciaNumero }` en el doc de
  origen (las dos colecciones).
- Bridge: `enviarTransferenciaATango()` es **stub** bajo el interruptor `config/tango.transferenciasEnabled`
  (apagado). Igual que los otros writers: no prenderlo hasta tener el writer real, porque con el
  stub cada item quema 5 intentos y pasa a `error`.

**Pregunta para Axoft / TC Servicios (bloquea el writer):** ¿qué proceso de la API mueve stock
entre depósitos (transferencia STA22 → STA22)? ¿Está cubierto por "ABMs y Consultas Live" o es una
transacción del módulo Stock que hay que licenciar aparte? ¿Y cómo se registra la merma (bolsas
rotas que vuelven en la descarga)?

## 14. Remito del camión → pedido en Tango: writer real del bridge (2026-09-03)

**Qué hace.** `enviarRemitoATango` en `scripts/tango/bridge-listener.mjs` ya no es stub: cada
item `entidad: 'remito'` de `tango-outbox` (venta de cuenta corriente, promo o solo cambios — ver
§12) se crea en Tango como **PEDIDO** (`POST Api/Create?process=19845`) en la empresa que diga el
item (`Company` resuelto contra `config/tango.companies`, §12). Ninguna API de Axoft crea remitos
(§6.2): el remito firmado vive en la app y viaja como referencia del pedido; Tango lo factura y
remita por su circuito. El depósito del pedido y de cada renglón es el **camión** (`ID_STA22`), así
la facturación descarga el stock del camión.

**Módulos.**
- `scripts/tango/tango-pedido.mjs` — armado PURO del `PedidoData` (sin red): referencia idempotente,
  fechas, renglones (ítems + cambios a precio 0), leyendas. Tests en `tango-pedido.test.mjs`
  (corren con `npx vitest run`).
- `bridge-listener.mjs` — cliente HTTP (`tangoRequest`, tolera respuestas Pascal/camelCase), cache
  de IDs maestros por empresa (`resolverId`), y el writer.
- `scripts/tango/mock-tango-server.mjs` — Tango simulado (GetByFilter/Create/GetById) para probar
  el flujo entero sin licencia: `node scripts/tango/mock-tango-server.mjs` + apuntar
  `tangoVentas.baseUrl` a `http://localhost:17000`. Verificado 2026-09-03 contra el emulador:
  creación, error claro por mapeo faltante + reintento, y reintento sin duplicar.
- `scripts/tango/configurar-ventas-tango.mjs` — muestra/escribe la config de abajo y lista lo que
  falta (artículos sin código, camiones sin depósito, contadores de numeración).

**Secuencia del writer** (todo por API, nada hardcodeado):
1. Lee `config/tango`: `articulos` (productoId → `COD_STA11`), `depositos` (camionId →
   `COD_STA22`), `camiones` (camionId → patente, solo para la leyenda), `pedido` (opcionales:
   `talonarioId`, `vendedorId`, `condicionVentaId`, `listaPreciosId: {contado, promo}`, `estado`
   (default 2 = ingresa aprobado), `comprometeStock` (default true)).
2. Valida: `clienteIdGva14Tango` en la venta, código de artículo para cada renglón (los cambios
   `cambio_X` usan `articulos.cambio_X` si existe, si no el artículo base a precio 0), depósito del
   camión. Si falta algo → error legible en `ultimoError`, NO se manda nada.
3. Resuelve IDs internos con `GetByFilter` (`filtroSql`): moneda (process 1660, `PES`), depósito
   (2941), artículos (87). Plantillas de filtro en `bridge-listener.config.json →
   tangoVentas.filtros` (default = sintaxis de los ejemplos oficiales; si la vista real usa otro
   nombre de columna se ajusta ahí, sin código).
4. Idempotencia: busca un pedido con `LEYENDA_1 = 'ROLITO:VC:<ventaId>'` (`VV` para ventanilla).
   Si existe, confirma con ese número sin crear otro. Si la búsqueda falla, avisa en el log y crea
   igual (mismo riesgo que antes).
5. `Create` → `SavedId` (ID_GVA21) → `GetById` para leer `NRO_PEDIDO` (best-effort).
6. Write-back: `resultado = { savedId, pedidoNumero, remitoNumero }`. `onOutboxConfirmado` copia
   `remitoNumero` a `ventasCamion/{id}.tango` como hasta ahora (el número de pedido de Tango).

**Leyendas del pedido** (60 chars c/u): `LEYENDA_1` referencia idempotente; `LEYENDA_2`
"Remito app 00002-00000015 - Contado" (número del comprobante interno de la app, o SIN NUMERO);
`LEYENDA_3` chofer + camión; `LEYENDA_4` quién firmó. `OBSERVACIONES` repite todo con el total.

**Config del bridge** (`bridge-listener.config.json`, ver el `.example`): bloque `tangoVentas`
(`baseUrl`, `token`, `procesos`, `filtros`, `monedaCodigo`, `timeoutMs`). `baseUrl`/`token` caen a
`tangoSaldos` si no están.

**Checklist para pasar a Tango real (TestingRH primero):**
1. En Tango: Administrador general → Datos de licencia → API → "Transacciones Tango Ventas" debe
   decir **Sí**. Si sigue en No, el `Create` va a fallar con 401/403 — el item queda `enviado` y el
   barrido lo reintenta cada 5 min hasta 5 veces (`error` después; se repone a `pendiente` a mano).
2. Número de TestingRH: URL `rhielotg:17000/company/{N}/` → `--companies N N`.
3. Códigos de artículo: correr `export-tablas-tango.ps1` en el server (baja artículos y depósitos
   a `Escritorio\tango-tablas`), copiar a `scripts/tango/tango-tablas/` y correr
   `cruce-articulos.mjs` para ver candidatos; cargar con `--articulo productoId=COD_STA11`.
4. Depósito de cada camión: `--deposito PATENTE=COD_STA22` (los camiones son depósitos STA22).
5. `--numeracion remito=<pv> --numeracion remitoPromo=<pv> --numeracion facturaX=<pv>` para que
   los remitos de la app salgan numerados (hoy salen SIN NÚMERO).
6. Copiar a la VM `bridge-listener.mjs` + `tango-pedido.mjs` + config; correr a mano
   `node bridge-listener.mjs`; luego `config/tango.remitosEnabled = true` (`--remitos on`).
   Instalar como servicio con NSSM (cabecera del script).
7. Verificar en Tango que el pedido entró con el depósito del camión, y que `ventasCamion/{id}.tango`
   quedó `confirmado` con el número.

**Sigue pendiente (no bloquea el remito):** `enviarFacturaATango` (necesita la respuesta de Axoft
sobre CAE externo, §12), talonario de pedidos (`pedido.talonarioId`, si Tango lo exige el `Create`
lo va a decir en `Message`), y las preguntas 2/5 de §6.2 (circuito de aprobación, descarga de stock
al facturar).

## 15. Facturas de la app → Tango por el Facturador (writer real, 2026-09-03)

**Qué hace.** `enviarFacturaATango` (bridge) registra en Tango cada item `entidad: 'factura'`
del outbox con `POST {baseUrl}/FacturadorVenta/registrar` (body = array de un comprobante),
headers `ApiAuthorization` + `Company` (resuelto contra `config/tango.companies`). Es la
"registración de comprobantes" de la API de Ventas (§12, ProcessId 20412 en el repo oficial).
- **Ventas contado de Redonhielo** (`conCaePropio: true`): FAC letra A/B/C con el **CAE que ya
  emitió la app** (`cAE`, `fechaVtoCAE`) — Tango NO le pide su propio CAE a ARCA. Los importes
  (`total`, `totalSinImpuestos`, `totalIva`) son EXACTAMENTE los de `factura.importes` que se le
  informaron a ARCA; los ítems se reconstruyen desde la venta y el redondeo se ajusta en el último
  ítem para que cierren. La percepción de IIBB (`importes.tributos`) va como `percepciones[]` por
  ítem, proporcional al neto, con la alícuota reconstruida (`tributos / neto`).
- **Ventas promo cobradas de Rolito** (factura X interna, sin CAE): FAC letra X, talonario propio,
  totales derivados de los ítems (IVA 21%). Requiere que el talonario X exista en Tango como no
  electrónico — decisión pendiente con el contador (§12 de FACTURACION_ELECTRONICA).
- Pago: `pagos[{ tipo: 'Efectivo', codigoDeCuenta, monto }]` con la cuenta de tesorería por forma
  de pago (`cuentas.contado_efectivo` / `cuentas.contado_transferencia`; la transferencia también
  va como tipo Efectivo contra la cuenta banco — el Facturador solo conoce Efectivo/Cheque/Tarjeta).
  Cuenta corriente → `cuotasCuentaCorriente` (no aplica hoy: cta cte va como remito/pedido, §14).
- **Idempotencia natural:** si el número ya está registrado Tango contesta `(51016) Ya existe el
  número de comprobante` y el bridge lo toma como confirmado (`yaExistia: true`).
- Write-back: `resultado.facturaNumero` (ej. `A0110400000001`) → `onOutboxConfirmado` lo copia a
  `ventasCamion/{id}.tango`.

**Módulos.** `scripts/tango/tango-factura.mjs` (puro: `documentoDeVenta`, `itemsDeVenta`,
`percepcionesPorItem`, `armarComprobanteFacturador`, `interpretarRespuestaFacturador`; 17 tests en
`tango-factura.test.mjs`) + writer en `bridge-listener.mjs` + endpoint `/FacturadorVenta/registrar`
en `mock-tango-server.mjs` (valida requeridos, artículos, total vs ítems y devuelve el 51016 real).
Verificado 2026-09-03 en el emulador con la factura A real del 2026-09-02 ($1 + IVA + 6% IIBB, CAE
86351147350772): registrada; factura X de promo: registrada; transferencia sin cuenta: error
legible → cuenta cargada → registrada; reintento de la A: 51016 → confirmada sin duplicar.

**Config por empresa** (`config/tango.facturador.<redonhielo|rolito>`, se carga con
`configurar-ventas-tango.mjs --facturador <empresa> clave=valor`, claves con punto = anidado):

| Clave | Qué es | Ejemplo |
|---|---|---|
| `talonarios.A` / `.B` / `.C` / `.X` | código de talonario (GVA43) por letra | `talonarios.A=20` |
| `condicionVenta` | código de condición de venta contado (GVA01) | `1` |
| `listaPrecio` o `listaPrecio.contado` / `.promo` | código de lista (GVA10) | `2` |
| `contracuenta` | código de contracuenta | `20` |
| `vendedor` | código de vendedor (GVA23) | `'3'` |
| `codigoTasaIva21` | código de la tasa IVA 21% en Tango | `1` |
| `cuentas.contado_efectivo` / `.contado_transferencia` | cuentas de tesorería | `'1'`, `'5'` |
| `codigoAlicuotaPercepcionIIBB` (+ `codigoPercepcionIIBB`) | código del impuesto "Percepción IIBB CABA" | `12` |
| `preciosIncluyenIva` | igual a `config/arca.preciosIncluyenIva` (default false) | `false` |
| `fechaCierreTesoreria`, `depositoVentanilla`, `tipoPago.<formaPago>` | opcionales | |

Comparte con §14: `articulos` (COD_STA11), `depositos` (COD_STA22, **2 chars** en el Facturador),
`camiones`. Interruptor: `config/tango.facturasEnabled` (`--facturas on`). Path del endpoint
ajustable en `bridge-listener.config.json → tangoVentas.facturadorPath` (default
`/FacturadorVenta/registrar`).

**Todos esos códigos salen de Tango** (talonarios, condiciones de venta, listas, vendedores,
cuentas de tesorería, tasas/alícuotas). No están en las 8 tablas de `export-tablas-tango.ps1`
(salvo listas/vendedores/condiciones): pedirlos por pantalla en Tango o por Live.

**Orden sugerido de puesta en marcha:** primero `facturasEnabled` con TestingRH (una venta contado
real de $1 → NC después, como el 2026-09-02); recién después Redonhielo real. Los remitos (§14)
siguen su propio camino.

## 16. Worker en Cloud Functions vía Tango Connect (2026-09-03) — reemplaza al bridge de la VM

**Hallazgo que lo habilita:** la API de Tango está expuesta a internet por Tango Connect en
`https://001174-003.connect.axoft.com` (llave 001174/003 con `/`→`-`), misma superficie que
`rhielotg:17000`: headers `ApiAuthorization` + `Company`, `Api/Get|GetByFilter|GetById|Create` y
`Api/FacturadorVenta/registrar`. Probado con el token de desarrollador desde la PC de Ariel y desde
fuera de la red (2026-09-03): Clientes (6087), Pedidos (19845), Facturador, empresas 1/2/3. Con eso
las Cloud Functions le pegan a Tango directo: **no hace falta el bridge en la VM, ni NSSM, ni acceso
al servidor**.

**Formas reales de la API** (difieren del readme en dos puntos): `GetByFilter` exige `filtroSql`
con `WHERE ` adelante (`WHERE AXV_ARTICULO.COD_STA11 = 'X'`, `WHERE STA22.COD_STA22 = '03'`,
`WHERE MONEDA.COD_MONEDA = 'PES'`, `WHERE AXV_PEDIDO.LEYENDA_1 = '…'`) y responde `{ list }` sin
`succeeded`; `GetById?process=&view=&id=` responde `{ value: {...} }` (PedidoData con IDs y
`RENGLON_DTO`). `Get` responde `{ resultData: { list, totalCount, totalPages }, succeeded }`.

**Código** (`functions/src`): `services/tango/pedido.ts` y `factura.ts` (port de los `.mjs`, mismos
tests), `client.ts` (`TangoClient`: request, `getByFilter`, `resolverId` con cache, `getById`,
`create`, `registrarComprobantes`), `writers.ts` (`enviarRemito`, `enviarFactura`, misma config
`config/tango`), `triggers/tangoWorker.ts`:
- `onOutboxPendiente` — `onDocumentWritten('tango-outbox/{id}')`: cuando un item queda en
  `pendiente` lo manda al toque.
- `barridoOutboxTango` — cada 5 min reintenta `pendiente`/`enviado` (el barrido es el backoff),
  hasta `MAX_INTENTOS=5` → `error`.
- Claim atómico en transacción (pendiente/enviado → enviado, intentos+1, `worker: 'cloud'`) antes
  de tocar Tango: trigger y barrido nunca mandan el mismo item dos veces.
- Solo entidades `remito` y `factura`; `produccionPallet`/`recibo`/`transferenciaDeposito` se
  dejan (siguen siendo del bridge/stubs).

**Interruptores en `config/tango`:** `workerCloud: true` (sin esto la Function no toca nada —
así nunca compite con el bridge de la VM si alguien lo prende), `remitosEnabled`,
`facturasEnabled`, `companies`, y opcional `connectBaseUrl`. Secret de Functions:
`TANGO_API_TOKEN` (token de desarrollador de Tango; al regenerarlo en Tango hay que volver a
cargarlo: `firebase functions:secrets:set TANGO_API_TOKEN`).

**Depósitos = repartidores.** En Tango cada chofer es un depósito (`03 SERGIO ALVAREZ`…):
`config/tango.depositos` va keyed por **uid del chofer** (fallback camionId), lo carga
`sincronizar-choferes-tango.mjs` (replica los depósitos-persona de Tango como choferes de la app:
vincula/crea/desactiva; `--vincular COD=CUIT=PIN` para que un chofer creado pueda entrar).

**Deploy:** `npm --prefix functions run build` → commitear `lib/` →
`firebase deploy --only functions:onOutboxPendiente,functions:barridoOutboxTango` (el secret tiene
que existir antes). Puesta en marcha: `companies` → TestingRH, `workerCloud: true`,
`remitosEnabled: true`, una venta promo real; después `facturasEnabled`.

## 17. Tango como fuente maestra de precios (2026-09-03)

Decisión: **los precios que ve la app son los de Tango**, no las listas de la app. La
app ya no calcula `precioEfectivo` (lista + `preciosCustom`) para clientes vinculados
a Tango; sólo el cliente ocasional de ventanilla sigue usando una lista de la app.

**Qué empresa manda:** el canal de la venta. Contado → Redonhielo (Company 1),
promo → Rolito (Company 3). Cada cliente puede tener una lista distinta en cada
empresa (`users.listaTango = { redonhielo, rolito }`).

**De dónde sale cada precio (API ABM):**
- Listas: `Api/Get?process=984` (GVA10: NRO_DE_LIS, DESCRIPCIO, INC_IVA).
- Precio por lista y especiales por cliente: ficha del artículo
  `Api/GetById?process=87&view=...&id=<ID_GVA01>` → `GVA17[]` {NRO_DE_LIS, PRECIO} y
  `GVA13[]` {COD_CLIENT, NRO_LISTA, PRECIO}. Se leen sólo los artículos mapeados en
  `config/tango.articulos` (sin los `cambio_*`).
- Lista del cliente: `Api/Get?process=2117` → COD_GVA14 → NRO_LISTA.

**Dónde queda en Firestore:** `preciosTango/{redonhielo|rolito}` =
`{ company, productos, listas: { [nro]: { nombre, incluyeIva, precios: { productoId } } },
especiales: { [claveCliente]: { productoId } }, resumen, actualizadoEn }`. La clave del
cliente es el código Tango con `.` → `_` (`FC.280` → `FC_280`; Firestore no admite
puntos en claves). Lectura: chofer, caja, operadores, gerencia, facturación,
supervisores. Escritura: sólo Admin SDK (`firestore.rules` + tests).

**Cuándo:** `syncPreciosTango` (onSchedule, todos los días 5:30 ART) y el callable
`sincronizarPreciosTangoAhora` (botón "Sincronizar ahora" en `/admin/precios`,
roles super_admin / gerente_general / gerente_comercial / comercial / facturacion).
Cada corrida guarda `config/tango.preciosSync` (última corrida, origen, duración,
resumen por empresa).

**Resolución en la app** (`src/utils/precioTango.ts`, `precioTangoDe`): precio
especial del cliente en esa empresa → si no, precio en su lista de esa empresa → si
no hay, **null**: el producto se muestra deshabilitado ("Sin precio en Tango") y la
venta no se puede confirmar. `motivoSinPrecioTango` explica el porqué (sin sync,
cliente sin código Tango, sin lista en esa empresa, lista inexistente). Aplica a
`VentaCamion` (chofer) y `VentanillaPage` (cliente registrado).

**Orden de deploy:** functions → reglas → **correr la primera sync** → hosting. Si el
frontend sale antes de que exista `preciosTango/*`, nadie puede vender.

### 17.1 Se eliminaron las listas de precios propias de la app (2026-09-03, tarde)

Decisión de Ariel: "la lista de la app borrala, usamos las listas de Tango". Se quitó
todo el circuito de `listas-precios` / `users.listaPreciosId` / `preciosCustom` /
`vigenciaCustom` (servicio, hook, editor en `/admin/precios`, selector en Gestión de
usuarios, modal de precios especiales, `precioEfectivo`). Ahora:

- **Clientes:** cada uno tiene en su ficha `listaTango`, `listaTangoNombre` y
  `preciosTango` (resueltos por la sync). Pedido nuevo, pedido manual, perfil del
  cliente, reporte de precios y tablero comercial leen eso. Sin vínculo con Tango, el
  cliente ve el catálogo sin precios (los confirma el administrador).
- **Validación server-side de pedidos** (`validarPreciosPedido`): la fuente autoritativa
  es `users.preciosTango.redonhielo`; sin eso, solo clampea cantidades.
- **Ventanilla, cliente ocasional:** caja elige una lista de Tango de la empresa del
  canal (solo se ofrecen las que tienen algún precio cargado).
- **`/admin/precios`:** pestañas "Listas de Tango" (solo lectura) y "Catálogo de
  productos". El catálogo sigue siendo de la app (nombre, unidad, foto, badge); el
  precio, de Tango.
- Los documentos viejos de `listas-precios` y `historialPrecios` quedan en Firestore
  sin que nada los escriba; las reglas se dejaron para no romper tests. Se pueden borrar
  cuando se quiera.

**17.2 (2026-09-03, noche):** borrados los 9 documentos de `listas-precios` en prod
(`historialPrecios` ya estaba vacía) y eliminado el historial de precios de la app
(página, sección en la ficha, hook, servicio, ruta y menú). Reglas: sin `match` para
`listas-precios` ni `historialPrecios` (tests actualizados: nadie lee ni escribe ahí).

## 18. Todo por Tango Connect: clientes, saldos y consultas sin la VM (2026-09-03)

Decisión de Ariel: migrar lo que quedaba en el bridge de la VM (`C:\RolitoSync`) a
Cloud Functions que hablan con Tango por Tango Connect, igual que precios y facturas.
`functions/src/triggers/tangoConnectSync.ts`:

| Qué | Function | Cuándo | Reemplaza a |
|---|---|---|---|
| Clientes (process 2117, Redonhielo) | `syncClientesTangoConnect` + callable `sincronizarClientesTangoAhora` | 5:00 y botón | `bridge-sync-clientes.mjs` → `syncClientesTango` (HTTP) |
| Saldos (Live 17953 vencidas + 17955 a vencer) | `syncSaldosTangoConnect` + callable `sincronizarSaldosTangoAhora` | cada hora 6–22 y botón | `bridge-sync-saldos.mjs` → `syncSaldosTango` (HTTP) |
| Consulta de saldo de un cliente (`tango-consultas`) | `onConsultaSaldoPendiente` (onDocumentCreated) | al crearse el doc | `bridge-listener.mjs` |

La lógica de negocio no cambió: la lectura se hace con `TangoClient.getAll` /
`TangoClient.live` (paginación ABM y Live) y las filas van a las mismas
`procesarLoteClientesTango` y `procesarLoteSaldos` que usaban las Functions HTTP
(matching por idGva14/CUIT, descuentos de cobranzas pendientes, vaciado por `runId`).
`onConsultaRespondida` sigue copiando el resultado al cache `saldosTango`.
La respuesta a consultas se escribe en transacción: si el bridge de la VM siguiera
prendido y respondiera antes, no se pisa.

Config: `config/tango.saldos {procesoDeudasVencidas, procesoDeudasAVencer, fromDate}`
(opcional, defaults 17953 / 17955 / 01/01/2015) y `config/tango.syncCloud
{clientes, saldos, consultas}` (llaves de apagado, default encendido). Cada corrida
deja `config/tango.clientesSync` / `saldosSync` (última corrida, origen, resumen);
se ven en **Ajustes generales → Sincronización con Tango**, con "Sincronizar ahora".

Primera corrida (script `scripts/tango/sincronizar-tango-connect.mjs`, 2026-09-03):
clientes OK; saldos 1823 comprobantes, 520 clientes con deuda, 279 con cuenta en la
app, 241 sin cuenta, 5 saldados. Las Functions HTTP viejas (`syncClientesTango`,
`syncSaldosTango`) quedan deployadas pero sin nadie que las llame; los scripts del
bridge quedan en el repo marcados como reemplazados. **Pendiente en la VM:** apagar
las tareas del Task Scheduler y el servicio del listener.

## 19. Recibos de cobranza por API: NO existe en Delta 6 (relevado 2026-09-03 en el Tango real)

Relevamiento hecho navegando Tango Delta por Connect (empresa TestingRH) con la sesión de Ariel:
- La API "Apertura" se autodocumenta por proceso en `/company/{n}/api/{proceso}` (ABM:
  Create/Delete/Update/Get/GetById/GetByFilter). El Facturador tiene ruta propia
  `/company/{n}/facturador-venta` (POST `FacturadorVenta/registrar`). Son las únicas rutas de
  API del frontend (router de Angular: `api/:actionNumber` y `facturador-venta`).
- **Cobranzas** (Ventas → Cuentas Corrientes) es el proceso **1957**, `migrated: false`
  (pantalla de escritorio). `/company/5/api/1957` → "Action not found". Lo mismo su importación
  Excel (`importar-plantilla/excel/1957`). Imputación de comprobantes (2127), Composición inicial
  (12306) y Débitos por mora (772) también `migrated: false`.
- El repo oficial TangoDeltaApi no tiene cobranzas; ninguna ruta `*/registrar` de recibos existe
  en Connect (25 nombres probados, y una ruta inexistente devuelve el mismo 500).

Conclusión: **hoy el recibo no se puede registrar por API.** Caminos: (a) preguntar a Axoft si hay
"Apertura de recibos" en roadmap / versión nueva; (b) SQL Server (mismo canal que los remitos R,
proyecto pendiente) — recibo GVA12 + imputaciones + tesorería, el más delicado; (c) mientras
tanto, la app sigue siendo el registro operativo (descuento optimista en saldosTango) y la
oficina carga los recibos en Tango con el listado de cobranzas de la app.

## 20. Proyecto "remitos y recibos por SQL Server" (decisión de Ariel, 2026-09-03)

Como la API no expone ni el remito R de cuenta corriente (§14: entraría como pedido) ni el
recibo de cobranza (§19: proceso 1957 sin API), ambos entran a Tango **escribiendo en la base
SQL Server**, como hacía Bluesoft. El día que Axoft migre esos procesos y aparezca su
"Apertura", se cambia el writer y el resto no se toca (el outbox ya encola `remito` y
`recibo` con todo lo necesario — §9 y §14).

### Arquitectura
- **Un servicio Node en el servidor de Tango** (donde vive SQL Server, red interna), que
  escucha `tango-outbox` con el usuario `tango-bridge` (igual que hacía `bridge-listener.mjs`,
  que se reutiliza como base) y para `entidad in ('remito','recibo')` escribe en SQL dentro de
  una transacción. SQL Server nunca se expone a internet; el servicio solo tiene salida HTTPS.
- **Firestore sigue siendo la cola**: claim atómico, reintentos por barrido, write-back a
  `ventasCamion.tango` / `cobranzas.tango`, mismo modelo que el worker de la nube (§16). El
  worker de la nube ignora `remito`/`recibo` (sus flags quedan apagados); el servicio SQL solo
  toma esas dos entidades.
- **Idempotencia**: antes de insertar, `SELECT` por la referencia (`LEYENDA`/observación
  `ROLITO:VC:<id>` en el remito, `ROLITO:<cobranzaId>` en el recibo). Un reintento nunca
  duplica. Numeración: se toma y se incrementa el próximo número del talonario en la misma
  transacción (remito R: talonario 1105 pto vta 01105 con CAI; recibo: talonario de recibos
  a definir con Ariel), respetando el número que la app ya imprimió.

### Fases
1. **Relevamiento en TestingRH** (`scripts/tango/sql/01-relevar-esquema.sql` y
   `02-trazar-tango.sql`): con una sesión de Extended Events se captura qué INSERT/UPDATE
   hace Tango cuando un operador carga un recibo y un remito a mano. Salida: lista exacta de
   tablas, columnas y valores (GVA12 cabecera, renglones, imputaciones de cta. cte.,
   movimientos de tesorería, stock del remito, talonario). Sin esto no se escribe una línea.
2. **Writer SQL** en el bridge (`mssql` de npm, Windows auth o login dedicado de solo esas
   tablas): `enviarRemitoSql`, `enviarReciboSql`, transacción + idempotencia + write-back.
   Tests unitarios del armado de sentencias (mismo estilo que `factura.test.ts`).
3. **Prueba en TestingRH**: un remito y un recibo de $1 desde la app → verificar en Tango
   (cuenta corriente del cliente, composición de saldos por Live 17953, stock del depósito,
   informe de tesorería). Cotejar contra los cargados a mano en la fase 1.
4. **Producción**: apuntar el servicio a Redonhielo (remito R + recibo) y Rolito si aplica,
   con flags `config/tango.remitosSqlEnabled` / `recibosSqlEnabled`; primera semana con
   control diario contra Tango.

### Riesgos conocidos
- Tango puede mantener saldos/stock por triggers o por la aplicación: la traza lo dice. Si
  es la aplicación, hay que replicar cada UPDATE (saldo del cliente, stock por depósito).
- Recibo con cheques y retenciones: cada medio es un movimiento de tesorería distinto;
  arrancar con efectivo y sumar medios de a uno.
- Cambios de versión de Tango pueden mover columnas: el writer valida el esquema al
  arrancar (columnas esperadas) y se frena con error legible si algo no coincide.

### Lo que hace falta de Ariel para arrancar la fase 1
- Nombre del servidor SQL / instancia y de las bases (TestingRH, Redonhielo, Rolito):
  paso 0 del script 01.
- Un acceso a SSMS en el servidor (Windows auth del usuario de RDP suele alcanzar) y, para
  el servicio, un login SQL dedicado con permisos solo sobre las tablas que salgan de la traza.
- Correr el script 02 mientras carga a mano UN recibo y UN remito en TestingRH y pasarme la
  salida del bloque B.
- Confirmar el talonario de recibos que usará la app (¿18 "RECIBO DON TORCUATO" REC X?).

## 21. Writer SQL: qué escribe Tango y qué replica la app (trazas del 2026-09-04)

Relevado con Extended Events en TestingRH mientras Ariel cargaba a mano un remito
(15-00480100) y un recibo (X00001-00032798). Trazas completas con valores:
`docs/tango/sql/traza-remito-2026-09-04.txt` y `traza-recibo-2026-09-04.txt`.
Lecciones de la herramienta: Tango usa sentencias preparadas (el texto está en
`statement`, no en `sql_text`), Cobranzas se identifica como "Microsoft Windows Operating
System" y Emisión de remitos como "Axoft Software"; el ring_buffer corta a 1000 eventos
→ archivo. Script definitivo: `scripts/tango/sql/02-trazar-tango.sql`.

### 21.1 Remito de ventas — implementado en `functions/src/services/tango/sql/remito.ts`
| Paso | Tabla | Qué | Lo hace |
|---|---|---|---|
| 1 | STA14 | Cabecera (60 columnas): T_COMP 'REM', TCOMP_IN_S 'RE', NCOMP_IN_S (8 dígitos, nº interno de stock), N_COMP = N_REMITO = 'R'+pv(5)+nº(8), TALONARIO, COD_PRO_CL, COD_DEPOSI, COD_TRANSP, COND_VTA, ID_DIRECCION_ENTREGA, ESTADO_MOV 'P', MOTIVO_REM 'V', USUARIO/TERMINAL, HORA_COMP 'HHMMSS' | app |
| — | STA14 | ID_STA13 (talonario) e ID_GVA14 (cliente) | **trigger de Tango** |
| 2 | STA20 | Renglón por artículo (50 columnas): CANTIDAD = CANT_PEND = CAN_EQUI_V, TIPO_MOV 'S', ID_MEDIDA_STOCK/VENTAS del artículo (STA11), PRECIO 0 | app |
| — | STA20 | ID_STA11, ID_STA14 | **trigger** |
| 3 | STA19 | `CANT_STOCK = anterior − cantidad` con WHERE del valor anterior (optimista) | app |
| 4 | STA14TY | Imagen del talonario para reimprimir | **no** (la app imprime; verificar) |
| — | GVA43 | PROXIMO del talonario | **no** (talonario 1105 exclusivo de la app) |

Idempotencia: `SELECT ID_STA14 FROM STA14 WHERE T_COMP='REM' AND N_COMP=@n` antes de
escribir; referencia `ROLITO:VC:<ventaId>` en LEYENDA1. Tests: `remito.test.ts` (10).
La ejecución real (transacción con `mssql`, claim del outbox, write-back) va en el
servicio de la VM — pendiente de las respuestas de abajo.

### 21.2 Recibo de cobranza — relevado, writer pendiente
Cuenta corriente: INSERT **GVA12** (T_COMP 'REC', TCOMP_IN_V 'RC', ESTADO 'IMP', N_COMP
'X'+pv+nº, TALONARIO, COD_CLIENT, COD_VENDED, IMPORTE = UNIDADES, REBAJA_DEB 1,
NCOMP_IN_V: **un trigger lo pone = ID_GVA12 si va 0/NULL**); INSERT **gva07** por cada
factura imputada (T_COMP/N_COMP de la factura, T_COMP_CAN/N_COMP_CAN del recibo,
IMPORT_CAN, ID_GVA12_CAN = id del recibo, FECHA_VTO/IMPORTE_VT de la factura — **los
triggers de gva07 recalculan solos ESTADO/ESTADO_UNI de factura y recibo (CTA/IMP/PAG/CAN)
y GVA46 (vencimientos PEN/PAG)**); INSERT **HISTORIAL_CUENTAS_CORRIENTES** (mismos datos +
ORIGEN 'Cobranzas', OPERACION 'A', id explícito); UPDATE **GVA14** SALDO_CC y SALDO_CC_U
(−importe, optimista); UPDATE GVA16 COTIZ (no-op); UPDATE **GVA43** PROXIMO (**codificado**,
no reproducible → talonario de recibos exclusivo de la app); INSERT gva12ty (imagen, no).
Tesorería: INSERT **SBA04** (COD_COMP 'REC', N_COMP, N_INTERNO de `dbo.INCREMENTAL_VALUE`
(Tabla 'SBA04', Campo 'N_INTERNO') — visto el UPDATE en la traza —, ID_SBA02 = 11 (tipo
REC), CLASE 1, CONCEPTO 'COBRANZAS POR VENTAS', COD_GVA14, TIPO_COD_RELACIONADO 'C',
GENERA_ASIENTO 'S', CN_ASTOR 'S', TOTAL_IMPORTE_CTE/EXT); 2× INSERT **SBA05** (renglón 0:
contracuenta 1120001 'H'; renglón 1: caja 1111000 'D'; triggers completan ID_SBA01 e
ID_SBA04); INSERT COMPROBANTE_COTIZACION_SB (id explícito, ID_MONEDA 2, ID_TIPO_COTIZACION
1); UPDATE **SBA01** saldos de las dos cuentas (SALDO_A_MO/A_UN/ACT, optimista); INSERT
ASIENTO_COMPROBANTE_SB + 2× ASIENTO_SB (ids explícitos; ID_CUENTA 1062 = deudores 'H',
601 = caja 'D' → cuentas contables del plan, mapeo a relevar).

### 21.3 Preguntas abiertas → consultas para correr en TestingRH (SSMS)
```sql
-- (a) ¿qué columnas son IDENTITY? (si lo son, no se pasa el id; si no, sale de INCREMENTAL_VALUE)
SELECT OBJECT_NAME(object_id) tabla, name columna FROM sys.identity_columns
WHERE OBJECT_NAME(object_id) IN ('STA14','STA20','GVA12','GVA07','HISTORIAL_CUENTAS_CORRIENTES','SBA04','SBA05','COMPROBANTE_COTIZACION_SB','ASIENTO_COMPROBANTE_SB','ASIENTO_SB');
-- (b) contadores que usa Tango
SELECT * FROM dbo.INCREMENTAL_VALUE ORDER BY Tabla, Campo;
-- (c) dirección de entrega habitual del cliente (STA14.ID_DIRECCION_ENTREGA = 8470 en la traza)
SELECT TOP 5 * FROM DIRECCION_ENTREGA WHERE ID_GVA14 = 8465;
-- (d) cuentas contables del asiento (1062 / 601) ↔ cuentas de tesorería 1120001 / 1111000
SELECT ID_SBA01, COD_CTA, DESCRIPCIO, * FROM SBA01 WHERE COD_CTA IN (1120001, 1111000);
SELECT * FROM CUENTA WHERE ID_CUENTA IN (1062, 601);
-- (e) tipo de comprobante de tesorería del recibo
SELECT * FROM SBA02 WHERE ID_SBA02 = 11;
-- (f) unidad de medida 17
SELECT * FROM MEDIDA WHERE ID_MEDIDA = 17;
-- (g) ¿el remito de la app necesita STA14TY? (probar reimprimir el 15-00480101 desde Tango con y sin fila)
```
Además, de Ariel: talonario de recibos exclusivo de la app en Redonhielo (REC, letra X,
pto vta propio) y login SQL para el servicio.

### 20.1 Implementado (2026-09-04, madrugada): writers + servicio, listos para probar en TestingRH

- **Writers** (puros, testeados, 23 tests): `functions/src/services/tango/sql/{tipos,remito,recibo}.ts`.
  Se compilan a `functions/lib/services/tango/sql/*.js` (solo dependen entre sí) y el
  servicio los carga desde `C:\RolitoSync\sql\lib\`.
- **Servicio**: `scripts/tango/bridge-sql.mjs` (+ `bridge-sql.config.example.json`). Usuario
  `tango-bridge` (SDK cliente, mismas reglas que el listener viejo), `mssql` con una
  transacción por comprobante, claim del outbox (`pendiente` → `enviado` → `confirmado` /
  `error` tras 5 intentos, barrido cada 5 min), write-back `resultado` con
  `remitoNumero` / `reciboNumero` (los lee `onOutboxConfirmado` como siempre), heartbeat
  en `config/tango.bridgeListenerLastSeen`. Flags: `config/tango.remitosSqlEnabled` y
  `recibosSqlEnabled`. **`--dry-run`**: ejecuta todo en TestingRH y revierte la transacción
  sin tocar la cola — es la prueba de la fase 3. `--once`: una pasada y sale.
- **Config en Firestore** (`config/tango.sql`, la carga `configurar-ventas-tango.mjs` o a mano):
  ```json
  {
    "remito": { "talonario": 1105, "puntoVenta": 1105, "codigoTransporte": "01", "usuario": "ROLITO", "terminal": "APP" },
    "recibo": { "talonario": 1106, "puntoVenta": 1106, "codVendedor": "AD", "concepto": "COBRANZAS POR VENTAS",
                "cuentas": { "contracuenta": 1120001, "efectivo": 1111000, "transferencia": 1113003 },
                "cuentasContables": { "1120001": 1062, "1111000": 601, "1113003": 605 }, "idSba02Recibo": 11,
                "usuario": "ROLITO", "terminal": "APP" },
    "empresas": { "rolito": { "remito": { "talonario": 1107, "puntoVenta": 1107 }, "recibo": { "talonario": 1108, "puntoVenta": 1108 } } }
  }
  ```
  `recibo.talonario/puntoVenta` = 1106 "Recibos App Rolito" (REC X, pto vta 01106) y `remito` = 1105 "Remitos App Rolito" (REM R, pto vta 01105), creados en TestingRH el 2026-09-04. El 1105 REM ya existía en REDONHIELO_SA ("Remito R App Rolito"); falta el 1106 REC ahí.
  **Los números de talonario son por empresa**: en Rolito 1104/1105 ya son las facturas A/B de ARCA, por eso
  `sql.empresas.rolito` pisa remito/recibo con 1107/1108 (a crear en Rolito). El servicio mezcla `sql.<entidad>` con `sql.empresas.<empresa>.<entidad>`.
  Verificado el 2026-09-04: cuenta 1113003 = BANCO GALICIA CTA CTE (ID_SBA01 5, contable 605); vendedor AD = ADMINISTRACION (ID_GVA23 9754);
  `cuentasContables` e `idSba02Recibo` se confirman con las consultas (d) y (e) de §21.3.
- **Config local en la VM** (`bridge-sql.config.json`): credenciales de `tango-bridge`, SQL
  Server (`server`, `user`, `password`) y `sql.bases` = base por empresa; para la prueba las
  dos apuntan a `TestingRH`.
- **Prueba (fase 3)**: crear en TestingRH un cliente/venta de prueba desde la app (remito cta
  cte y una cobranza de supervisor de $1), correr `node bridge-sql.mjs --dry-run` y mirar
  el log; después sin `--dry-run` y verificar en Tango (Cuentas Corrientes del cliente,
  Live 17953, stock del depósito, Tesorería). Comparar contra los cargados a mano
  (15-00480101 y X00001-00032798) columna por columna con `SELECT * FROM STA14/GVA12/...`.

## 22. Stock del reparto: lo que escribía Bluesoft y el modelo propuesto (2026-09-04)

Relevado en TestingRH (`docs/tango/sql/muestras-stock-2026-09-04.json`, consultas (q)–(z6)).
**Bluesoft dejó de existir el 2026-08-20**; desde entonces nadie genera estos comprobantes.

| T_COMP | TCOMP_IN_S | Qué es | Cabecera STA14 | Renglones STA20 |
|---|---|---|---|---|
| CAR | TI | carga planta → camión | COD_DEPOSI NULL, talonario 13 (ID_STA13 145), N_COMP `0025`+8 | por artículo: E en camión (DEPOSI_DDE=01) + S en 01 |
| DES | TI | descarga camión → planta | ídem, ID_STA13 146, USUARIO=chofer, TERMINAL `TELEFONO` | E en 01 + S en camión; incluye PALLETMETA y RACKAG034 |
| REM | RE | remito de venta | (writer hecho §21) | artículos reales, egreso del camión |
| FAC / BOL | FR / AJ | factura / boleta contado | | hoy lo cubre ARCA + Tango Connect |
| CBS | VE | cambio por cliente | COD_PRO_CL=cliente, talonario 2 (ID_STA13 144), USUARIO=chofer, N_COMP `0001`+8 | UN renglón: artículo `CAMBIOxxx` × cant, COD_DEPOSI **99**, TIPO_MOV E. Sin GVA12 |
| MER | TI | "DESCARGA Y MERMA" | talonario 4 (ID_STA13 132) | artículo REAL: E en 99 (DEPOSI_DDE 01) + S en 01 |
| PDT / PRO | VE | producción Torcuato / Merlo | USUARIO SUPERVISOR, a mano | (candidato a writer desde `produccionPallets`) |

Hallazgos: (1) `STA14.TALONARIO` de stock apunta a **STA13**, no a GVA43. (2) Los artículos
`CAMBIO*` **sí mueven stock**: 99 acumula 88.503 CAMBIOHIELO3KG / 94.738 CAMBIOHIELO4KG y los
depósitos de camión tienen negativos (06: −138) por 78 REM + 1 FAC que los incluyeron. (3) El CBS
no saca la bolsa buena del camión; la merma queda registrada dos veces (CAMBIO en CBS, real en MER).

**Modelo propuesto** (pendiente de decisión de Ariel): CAR y DES iguales, con artículos reales;
venta sin cambios; **cambio = transferencia camión → 99 con el artículo real**, cliente y chofer en
cabecera (conserva la trazabilidad del CBS, elimina el artículo ficticio); DES solo con lo sano
contado; faltantes de la liquidación camión → depósito nuevo "98 DIFERENCIAS DE REPARTO";
artículos CAMBIO solo como renglón informativo a $0 en la factura, configurados para no mover
stock. Cada camión cierra el día en 0. MER queda para merma originada en planta.

## 23. Fase A a producción: remitos y recibos por SQL en REDONHIELO_SA y Rolito (2026-09-05)

Objetivo: que desde el lunes 2026-09-07 el remito R de cuenta corriente del camión y el recibo
del supervisor entren solos a Tango. Estado al 2026-09-05: fase A probada real en TestingRH
(§21), servicio y config listos en el Escritorio (`TXT SINCRONIZACION TANGO\bridge-sql`, idéntico
al repo incluido el fix de fechas), nada instalado todavía en RHIELOTG.

**Qué viaja y qué NO (importante para la oficina):**
| Operación en la app | Tango | Cómo |
|---|---|---|
| Venta camión/ventanilla contado (Redonhielo) | Factura con CAE de la app | Facturador, Tango Connect (ya en prod) |
| Venta promo (Rolito) | Factura manual A/B | Facturador, Tango Connect (ya en prod) |
| Venta camión/ventanilla **cta cte** (Redonhielo) | **Remito R 01105 / 01107** | `bridge-sql` (esta fase) |
| Cobranza de **supervisor** (efectivo/transferencia con imputación) | **Recibo X 01106 / 01108** | `bridge-sql` (esta fase) |
| Cobranza de supervisor con **cheques** | **Recibo X + cheque en cartera** (SBA14/SBA23, VALORES A DEPOSITAR 1112000) | `bridge-sql` — en prod desde el 2026-09-05 17:00 (primer real: X 01106-00000041, cheque 87654321) |
| Cobranza de supervisor con **retenciones** | queda en `error` en la cola | TestingRH no tiene códigos de retención cargados (F7 vacío): preguntar a la oficina cómo las registra |
| Cobranza del **chofer en la calle** y de **caja/mostrador** | **no viaja** | `onCobranzaCreada` solo encola `origen:'supervisor'`; el writer exige imputaciones (no hay "recibo a cuenta"). Mejora siguiente: trazar un recibo a cuenta en TestingRH y extender el writer |
| Remito de carga / descarga | no viaja | fase B (transferencias, STOCK_REPARTO.md) |

**Hecho el 2026-09-05 desde acá:** `config/reciboSupervisorCounter = { next: 1 }` en prod (sin él
el recibo sale sin número y el writer lo rechaza: "numeroRecibo inválido"); `scripts/tango/sql/06-produccion.sql`
(login con contraseña larga + permisos del script 05 en las dos bases + bloque D de verificación);
`INSTALAR-PRODUCCION.txt` en la carpeta del Escritorio con los 6 pasos para el servidor.

**Pasos en RHIELOTG (Ariel, por RDP):** (1) talonarios 1106 REC X en REDONHIELO_SA y 1107 REM R +
1108 REC X en Rolito, como los de TestingRH; (2) `06-produccion.sql` bloques A–C con la contraseña
nueva, bloque D y pegar la salida; (3) copiar la carpeta a `C:\RolitoSync\sql`, poner la contraseña
y `sql.bases = { redonhielo: REDONHIELO_SA, rolito: Rolito }`; (4) `npm install` y
`node bridge-sql.mjs --dry-run --once`; (5) Task Scheduler `RolitoBridgeSql` al iniciar, como SYSTEM;
(6) avisar: se verifica el latido `config/tango.bridgeListenerLastSeen` y recién ahí se prenden
`remitosSqlEnabled` / `recibosSqlEnabled`. Primer comprobante real con `--dry-run --solo=<id>` y
después `--solo=<id>` (§20.1), verificando en Tango.

**EN PRODUCCIÓN desde el 2026-09-05 12:20.** Los 6 pasos hechos con Ariel por RDP: talonarios
1106/1107/1108 creados en Tango Ventas (ojo: no en el de Stock), script 06 corrido (login con
contraseña larga en Bitwarden, permisos en las dos bases), servicio actualizado en
`C:\RolitoSync\sql` (config con bases REDONHIELO_SA/Rolito), `--probar-sql` OK en ambas bases, tarea
`RolitoBridgeSql` (SYSTEM, al iniciar, vía `bridge-sql.cmd` con reinicio automático), latido en
`config/tango.bridgeListenerLastSeen`. Primer comprobante real: venta cta cte de prueba a FC.280 →
`--dry-run --solo` limpio → `--solo` real → **R 01105-00000041** visible en Tango (ID_STA14 890391,
depósito 21, pendiente de facturar) y write-back en `ventasCamion.tango`. Después se prendieron
`remitosSqlEnabled` y `recibosSqlEnabled`. Nota para contaduría: los R 01105 nº 1 a 40 fueron
pruebas borradas → registrarlos como anulados (talonario con CAI).

**Cheques de terceros en el recibo (2026-09-05, tarde).** Traza XE del recibo X 01106-00000002 en
TestingRH con un cheque diferido (`docs/tango/sql/traza-recibo-cheque-2026-09-05.txt`). Además de lo
del recibo en efectivo, Tango escribe: renglón SBA05 'D' sobre la cartera **1112000 VALORES A
DEPOSITAR** (e-cheq: 1112002) con la suma de los cheques; por cheque **SBA14** (43 columnas: ESTADO
'C', TIPO_CHEQU 'D' si tiene días / 'C', F_EMISION, FECHA_CHEQ = cobro, FECHA_REC, IMPORTE_CH,
N_CHEQUE, N_CUIT y RAZON_EMIS del cliente, N_INTERNO = MAX+1 —no hay INCREMENTAL_VALUE—, NRO_SUCURS
3, ID_BANCO de `BANCO` por COD_BANCO = código BCRA; triggers completan ID_GVA14/ID_CPA01), **SBA23**
(historial, ESTADO 'C', HORA_MOV HHMM) y **MOVIMIENTO_CHEQUE_TERCERO** (ID_SBA14 ↔ ID_SBA05 del
renglón de cartera, 'INGR'); asiento con la contable 602 (CUENTA.COD_CUENTA = COD_CTA). SBA90 es
temporal de la pantalla y no se replica. Writer: `recibo.ts` (23 tests); config en
`config/tango.sql.recibo`: `cuentas.cheques/echeq`, `cuentasContables` 1112000/1112002 → 602,
`cheques { nroSucursal: 3, tablaBancos: 'BANCO', columnaCodigoBanco: 'COD_BANCO' }`. Permisos nuevos
del login: INSERT en SBA14, SBA23 y MOVIMIENTO_CHEQUE_TERCERO (scripts 05/06). Prueba real:
cobranza RS-000041 de $23.602 a FC.280 imputando la FAC 282328 con cheque 87654321 Galicia a 30 días
→ X 01106-00000041 (ID_GVA12 372527) en REDONHIELO_SA, cache de saldos descontado. Hallazgos del
camino: las reglas no dejaban al super_admin crear cobranzas de supervisor (arreglado, con test) y
`fireAndForget` tragaba el rechazo (ahora avisa en pantalla). Retenciones: siguen frenando.

**Cobertura verificada en prod (2026-09-05):** 951/966 clientes activos con `codigoTango` (15 sin
código: sucursales de cadenas y algún cliente nuevo → una venta cta cte a ellos queda en error);
9/11 productos del catálogo con artículo (`anticorrosivo` y `agua_6l` sin código → remito en
error si se venden); 8/11 choferes con depósito (Pereyra, Molina y Marsicano sin depósito → si
venden cta cte, el remito queda en error hasta cargarlos en `config/tango.depositos`). Un item en
error no se pierde: queda en `tango-outbox` con `ultimoError` y se reprocesa al corregir la config
(volverlo a `pendiente`).

## 24. Stock del reparto en Redonhielo: egreso VPR por venta promo y Rolito sin stock (2026-09-05)

**Decisión de Ariel (2026-09-05, noche):** TODO el stock vive en la empresa REDONHIELO. Rolito solo
recibe las facturas no oficiales (promo) y **no lleva stock**. Hasta hoy la factura promo se
registraba en Rolito con `descargaStock: true` y el depósito del camión → descontaba en la base de
Rolito (donde nunca entra nada: camiones en negativo) y no descontaba en Redonhielo (donde entra la
carga: stock de más). La promo en $0 (solo cambios) entraba a Rolito como remito y también tocaba
STA19 allá.

**Modelo nuevo (código listo, pendiente de traza + deploy):**

| Venta | Comprobante | Empresa | Stock |
|---|---|---|---|
| Contado efectivo/transferencia | FAC con CAE (Facturador) | Redonhielo | la factura descarga del depósito del camión (sin cambios) |
| Contado cta. cte. | REM por SQL (§21) | Redonhielo | el remito descarga (items + cambios) |
| Promo (cobrada, cta. cte. **o $0**) | FAC A/B sin CAE (Facturador), `descargaStock: false` | Rolito | **egreso VPR por SQL** desde el depósito del camión en **Redonhielo** (items + cambios) |

- `destinoTango('promo', *, ≤0)` pasó de `remito` a `factura`: en Rolito queda una **factura en $0
  con los renglones de cambio** (artículos `CAMBIO*`, que no mueven stock), sin `pagos` ni cuotas. La
  app también emite factura X en ese caso (`tipoComprobanteInterno` → `facturaX`; las ventas viejas
  con `remitoPromo` se siguen reimprimiendo por el tipo guardado). **Riesgo a probar en TestingRH:**
  que el Facturador rechace total 0 → fallback: no mandar nada a Rolito para ese caso.
- Nueva regla pura `movimientoStockDeVenta(canal, …)` en `circuito.ts`: promo → `{ movimiento:
  'ventaPromo', empresa: 'redonhielo' }`. `onVentaCamionCreada` / `onVentaVentanillaCreada`
  (helper `encolarVenta`) encolan, además del comprobante, un item `<col>_<id>_stock` con entidad
  **`movimientoStock`** y payload `{ movimiento: 'ventaPromo', venta }`.
- Writer único `functions/src/services/tango/sql/movimientoStock.ts` (egreso o transferencia;
  sirve para CAR/DES/cambios en la fase B) sobre `comun.ts` (cabecera STA14 de 60 columnas, renglón
  STA20 de 50, UPDATE STA19 optimista, `siguienteNcompInS`, compartidos con `remito.ts`). Orden:
  `UPDATE STA17 PROXIMO` optimista (numera con el talonario de stock, PROXIMO es plano) → `INSERT
  STA14` (T_COMP `VPR`, N_COMP = sucursal (5) + nº (8), COD_PRO_CL = cliente, COD_DEPOSI = camión,
  LEYENDA1 = `ROLITO:VC:<id>` idempotente, LEYENDA2..4 = factura Rolito / chofer / cliente) →
  `INSERT STA20` 'S' por artículo (transferencia: 'E' destino + 'S' origen como la muestra CAR) →
  `UPDATE STA19` (−origen, +destino). 22 tests (`movimientoStock.test.ts`), con las hipótesis
  pendientes de la traza concentradas en `HIPOTESIS_TRAZA` (TCOMP_IN_S del egreso, ancho de la
  sucursal, CANT_PEND/IMPUESTO_INTERNO_FIJO 0, depósito en cabecera).
- Bridge: `HANDLERS.movimientoStock` (flag **`stockSqlEnabled`**), `depositoDe()` compartido con
  el remito, `--probar-sql` chequea `UPDATE STA17` y que exista VPR en STA13. Instalación: copiar
  `bridge-sql.mjs` + `lib/{tipos,comun,remito,recibo,movimientoStock}.js`.
- Write-backs (`onOutboxConfirmado`) ahora con dot-paths: la venta promo recibe dos confirmaciones
  (factura Rolito → `tango.facturaNumero`; egreso → `tango.stockEstado/stockNumero/stockTipo`) y la
  segunda no pisa la primera.
- Config: `config/tango.facturador.rolito.descargaStock = false`; `config/tango.sql.stock = {
  usuario, terminal, tipos: { ventaPromo: { tipo: 'egreso', tComp: 'VPR', tcompInS: <traza>,
  talonario: <ID_STA17>, incluyeCambios: true } } }`; `stockSqlEnabled`. Script:
  `scripts/tango/configurar-stock-tango.mjs`. Permisos: `scripts/tango/sql/08-stock.sql`
  (SELECT STA13/STA17, UPDATE STA17 en REDONHIELO_SA y TestingRH).
- Carga/descarga (fase B): siguen encolándose como `transferenciaDeposito`; usarán el mismo writer
  con el talonario 13 compartido (decisión de Ariel: UPDATE optimista de PROXIMO). `incluyeCambios`
  pasa a `false` cuando exista el writer de cambio camión → 99.

**Traza hecha (2026-09-05, 22:42 y 22:49, TestingRH — `docs/tango/sql/traza-stock-2026-09-05.csv`).**
Talonario de stock creado desde Tango: código **900**, sucursal 900, "cantidad máxima de
iteraciones" = **999** (es el tope de renglones por comprobante: con 1 Tango tira "LIMITE EXCEDIDO"
al cargar el primer artículo); en STA17 el código (TALONARIO 900) y el ID (ID_STA17 14) son
distintos y **el código es el que vincula** (STA13.TALONARIO, STA14.TALONARIO). Tipo VPR: salida,
sin valorizar, talonario 900. Egreso VPR 00900-00000001 (1 bolsa, depósito 01) y transferencia TRA
00025-00067900 (01 → 03). Lo que graba Tango, confirmado y ya aplicado al writer:
- Orden: INSERT STA14 → INSERT STA20 → UPDATE STA19 → UPDATE STA17 (PROXIMO 1 → 2, WHERE con el
  PROXIMO leído: optimista). El writer hace el STA17 primero; da lo mismo dentro de la transacción.
- Egreso: `TCOMP_IN_S = 'VS'`, `NCOMP_IN_S` = MAX+1 dentro de 'VS' (00001128; **no** usa
  INCREMENTAL_VALUE — el writer de stock tampoco). Transferencia: 'TI', 00073673.
- `N_COMP` = **' ' + sucursal (5) + número (8)** = 14 caracteres con espacio adelante
  (`' 0090000000001'`, `' 0002500067900'`). El write-back lo guarda sin el espacio.
- Cabecera: COD_PRO_CL '', **COD_DEPOSI ''** (el depósito va solo en el renglón), ESTADO_MOV '',
  MOTIVO_REM '', N_REMITO '', COD_TRANSP '', OBSERVACIO = observaciones de la pantalla, LEYENDA1..5 =
  las 5 leyendas, ID_DIRECCION_ENTREGA NULL, COND_VTA 0, **HORA_ANU/USUARIO_ANU/TERMINAL_ANU NULL**
  (el remito los graba ''), USUARIO/USUARIO_INGRESO 'SUPERVISOR', TERMINAL_INGRESO 'RHIELOTG'.
- Renglón STA20: CANT_PEND 0, IMPUESTO_INTERNO_FIJO 0, ID_MEDIDA_STOCK 17, **ID_MEDIDA_VENTAS NULL**,
  DEPOSI_DDE '' en el egreso; transferencia: 'E' en destino (DEPOSI_DDE = origen, N_RENGL_S 1) y
  'S' en origen (DEPOSI_DDE = destino, N_RENGL_S 2). STA19: UPDATE optimista, destino primero.
- Ninguna otra tabla (no hay STA14TY, ni auditoría, ni partidas). Los triggers completan ID_STA13
  (por T_COMP), ID_STA11, ID_STA14, ID_STA22; ID_GVA14 solo para tipos de ventas (RE/FR/CC/…), así
  que el COD_PRO_CL que la app graba en el VPR queda como texto (igual que los CBS de Bluesoft).
- Falta ver: qué hace Tango si el depósito destino no tiene fila en STA19 (los dos la tenían).

**Pendiente antes de prender:** (1) crear en REDONHIELO_SA el talonario 900 (iteraciones 999) y
el tipo VPR igual que en TestingRH; (3) script 08;
(4) `configurar-stock-tango.mjs --rolito-sin-stock on` **antes** del deploy de
`onVentaCamionCreada, onVentaVentanillaCreada, onOutboxConfirmado, onOutboxPendiente,
barridoOutboxTango`; (5) `--tipo ventaPromo …` con el ID_STA17 real; (6) primera promo real con
`--dry-run --solo` / `--solo` y verificación STA14/STA20/STA19/STA17; (7) `--stock on`.
Nota: el STA19 de la base Rolito ya no tiene significado (quedó con descuentos de pruebas y promos
reales); si contaduría lo pide, AJU a 0 desde Tango.

**Vendedores por chofer (2026-09-05, 23:50).** La factura de la venta de prueba quedó en reintento:
"el chofer Primiterra no tiene vendedor de Tango". Solo Sergio tenía vendedor (AS, y solo en
Rolito). Decisión de Ariel: **un vendedor por chofer con código = número de su depósito** (03
Alvarez, 04 Gallo, 19 Morinigo, 21 Primiterra, 22 Jara, 31 González, 50 Diaz, 51 Gerez) — misma
identidad que el camión, entra en los 2 caracteres de COD_GVA23 y no choca con los existentes (las
iniciales chocaban: DA, GG, ME). Más el respaldo **AP - APP ROLITO** para choferes sin vendedor
propio (`facturador.<empresa>.vendedor`). Creados por Tango Connect (`Api/Create?process=952`
funciona con la licencia actual) en TestingRH, REDONHIELO_SA y Rolito con
`scripts/tango/crear-vendedores-tango.mjs`; `--config` escribió `config/tango.vendedores`. AS queda
en Tango solo para el historial. Pereyra, Molina y Marsicano siguen sin depósito ni vendedor
(facturan con AP hasta que la oficina les asigne camión).

**Cierre de la prueba punta a punta (2026-09-06, 00:10).** Venta promo ventasCamion/2tnXkglyQxUf07YzFplL
(Primiterra, dep 21, 1 bolsa 3 kg, FC.280): egreso **VPR 00900-00000001** en REDONHIELO_SA (ID_STA14
890393, visible en la ficha Live de Tango) + factura **A 01104-00000062** en Rolito **sin movimiento de
stock** (el último STA14 de Rolito sigue siendo del 03/09). Hallazgo: el Facturador exige
`codigoDeposito` aunque `descargaStock` sea false (sin él rechaza con `exceptionMessage: "*"`); la
factura se manda con el depósito del chofer y `descargaStock: false` y no toca STA19. Además el
cliente Tango ya no tira excepción cuando la respuesta trae `Comprobantes[]` (el "ya existe" 51016
se interpreta como OK). Ambos comprobantes de prueba quedan para anular desde Tango.
Script nuevo `scripts/tango/reintentar-outbox.mjs` para volver a 'pendiente' items en error.

## 25. Multi-empresa: padrón y saldos de Redonhielo Y Rolito, un recibo por empresa (2026-09-06)

Hasta acá la app leía el padrón y los saldos solo de Redonhielo (Company 1); la deuda de la promo en
cta cte (facturada en Rolito, Company 3) no se veía ni se cobraba desde la app. Decisión de Ariel:
"dos bloques separados; si el recibo es de Rolito que sea de Rolito, si no los saldos no quedan bien".

**Identidad del cliente por empresa** — `users/{uid}.tangoIds = { redonhielo: [{ idGva14, codigo }], rolito: [...] }`
(`functions/src/services/tango/empresas.ts`, espejo en `src/utils/tangoEmpresas.ts`). Un CUIT = una cuenta;
en cada empresa puede tener varios códigos (sucursales / grupos), el primero es el principal. Los campos
viejos `idGva14Tango` / `codigoTango` siguen como alias del principal de Redonhielo (`tangoIdsDe()` los
absorbe cuando la ficha todavía no tiene `tangoIds`).

**Sync de clientes** (`tangoConnectSync.ts` → `sincronizarClientes`, `tangoSync.ts` → `procesarLoteClientesTango`):
recorre `EMPRESAS` con un índice de cuentas armado UNA vez por corrida (antes: un escaneo de `users` por lote).
Redonhielo manda la ficha (razón social, IVA, domicilio, email…); Rolito solo vincula identidad, salvo que el
cliente exista únicamente en Rolito. Match por `tangoIds[empresa].idGva14` → CUIT **válido** (dígito verificador,
`cuit.ts`; los rellenos tipo 00000000000 no vinculan) → en Rolito, código igual al de Redonhielo. Otra fila con
el mismo CUIT → código secundario (`codigosSecundarios` en el resumen). Resumen en `config/tango.clientesSync.resumen.empresas`.

**Saldos** (`tangoSaldos.ts`, lógica pura en `services/tango/saldos.ts` con tests): `saldosTango/{uid}` guarda las
DOS empresas en el mismo doc:

```
{ idGva14, codigoTango, razonSocial,             // legacy: principal de Redonhielo
  comprobantes: [ {…, empresa, codigoTango} ],   // unión de las dos empresas
  saldoTotal,                                    // Σ de las dos (la lista de deudores ordena por esto)
  porEmpresa: { redonhielo: { saldoTotal, comprobantes, runId, origen, actualizadoEn }, rolito: {…} },
  cobranzasAplicadas, actualizadoEn, origen, runId }
```

Cada sync/consulta/cobranza reemplaza **solo su rama** (`fusionarRamaEmpresa`, read-modify-write por lote con
`getAll`). `runId` es por empresa (`"<empresa>:<iso>"`): al terminar la corrida de una empresa se vacía la rama de
esa empresa en los docs cuyo `porEmpresa.<e>.runId` no es el de la corrida (más los docs anteriores al formato,
sin `porEmpresa`, cuando corre Redonhielo). Los códigos de un mismo CUIT se agrupan antes de partir en lotes. Las
consultas Live por empresa se pueden pisar en `config/tango.saldos.porEmpresa.<empresa>.{procesoDeudasVencidas,procesoDeudasAVencer,fromDate}`.
El descuento optimista (`descuentosDeCobranzas`) lleva la empresa en la clave y ya no filtra por origen
`supervisor` (caja y chofer también cobran desde el 2026-09-05).

**Saldo en vivo** (`useSaldoClienteEnVivo`): una consulta `tango-consultas` por empresa vinculada, en paralelo,
con `idsGva14` (todos los códigos). Regla: `empresa in ['redonhielo','rolito']` obligatoria.

**Cobranza** (`CobranzaCompleta.tsx`): bloques por empresa (y por código si hay varios), subtotal y frescura por
bloque; al tildar una factura los otros bloques se apagan ("un recibo por empresa"). La cobranza lleva `empresa` y
`codigoTango` del bloque; `onCobranzaCreada` resuelve `clienteIdGva14Tango`/`clienteCodigoTango` en esa empresa y
pone `empresa` también a nivel de item del outbox. Las ventas: `payloadDeVentaEn()` reemplaza el id/código del
cliente por el de la empresa destino (la app graba los de Redonhielo).

**Verificación** — `scripts/tango/verificar-live-empresas.mjs` (con `$env:TANGO_TOKEN`) lista filas y columnas de
17953/17955 por Company y, con `--cliente=FC.280`, el ID_GVA14 del cliente en cada una. Pendiente en Rolito:
`GRANT EXECUTE ON dbo.P_COBRANZAESTADOSVENTAS TO rolito_bridge` (sin eso el recibo deja la factura en PEN).

## 26. Padrón maestro: altas y bajas automáticas de clientes desde Tango (2026-09-06)

Decisión de Ariel: "mi base es Tango, todo lo que está en Tango tiene que estar en la app". Lógica pura en
`functions/src/services/tango/clientes.ts` (tests), cola y creación en `triggers/tangoAltas.ts`, bajas en
`sincronizarClientes` (`tangoConnectSync.ts`). Interruptores en `config/tango`:
`altas.enabled` (la sync encola), `altas.crear` (se crean), `bajas.enabled` (se aplican; sin él solo se cuentan),
`bajas.maxPorCorrida` (500).

**Alta.** Fila de Tango (de cualquiera de las dos empresas) HABILITADA, con CUIT válido (dígito verificador;
"00000000000" y consumidor final no) y sin cuenta en la app → doc `tango-altas/{cuit}` con todas sus filas (un
CUIT = una cuenta, varios códigos). `altasClientesTango` (cada 10 min) / `procesarAltasTangoAhora` (botón
"Crear cuentas ahora" en Ajustes) los procesa de a 400: reclamo atómico del doc (`pendiente` → `procesando`),
Auth `<cuit>@rolito.app` con contraseña = CUIT (Ariel acepta el riesgo; el cliente la cambia si quiere),
`users/{uid}` modelo `emailAuth` activo con `aprobadoPor: 'tango'` y SIN `creadoPor` (no dispara los emails de
`triggers/users.ts`), `tangoIds` de las dos empresas, una dirección por código (`addresses[].id` = código),
`cuitIndex/{cuit}`. Si el email de Auth ya existe se reusa el uid (mismo dominio que los choferes: si el uid es
de otro rol, `error` y no se pisa). Estados de la cola: `pendiente | procesando | creada | existia | error`.

**Baja / reactivación.** Solo cuentas con identidad Tango. Al terminar la corrida completa: cuenta cuyas filas
no aparecieron en ninguna empresa o aparecieron todas inhabilitadas → `estado: 'inactivo'`, `bajaTango: {fecha,
motivo}`, Auth `disabled` + tokens revocados. Nunca se borra el doc ni el `cuitIndex`. Vuelve habilitada → se
reactiva (solo si la baja la hizo la sync: `bajaTango` presente). Circuit breaker: empresa que devolvió menos del
80 % de filas que la corrida anterior, o que falló → no da de baja a nadie esa vez (`bajas.corridaConfiable`).

**Primera corrida real (2026-09-06):** 1128 cuentas creadas (941 en las dos empresas, 63 solo Redonhielo, 124
solo Rolito); 5689 filas inhabilitadas y 255 con CUIT inválido no se crean (el panel lista ejemplos). 33 cuentas
existentes marcadas para baja por estar inhabilitadas en las dos empresas. Incidente: el barrido programado y el
botón corrieron a la vez y, como Firebase Auth del proyecto admite varias cuentas con el mismo email, 140 CUIT
quedaron duplicados → `scripts/tango/limpiar-altas-duplicadas.mjs` los limpió y el reclamo atómico lo evita.

**Volumen en la app:** `userService` pasó de `limit(6000)` a 25000 (truncaba en silencio ordenado por
`fechaCreacion desc`), la búsqueda de pedidos por código usa el caché de usuarios, `useSucursales` cachea 5 min,
los KPIs comerciales excluyen cuentas de Tango sin pedidos y el mapa de planificación geocodifica como máximo
300 clientes sin coordenadas por apertura.

## 27. Expedición por DEPÓSITO de Tango: carga, descarga, venta y liquidación (2026-09-06)

En Tango cada repartidor es un depósito en tránsito (03 SERGIO ALVAREZ … 55; tercerizados como NOAIN 01-06, ORONA,
ALMIRON, GRUPO 2000; los supervisores 23/24/25 también). Ariel: "en la app anterior se veían todos los depósitos:
si salía, se buscaba ese depósito y se liquidaba; en carga tienen que poder cargar todos los depósitos". Hasta acá
la app fijaba "repartidor = usuario con rol chofer".

**Catálogo `depositosTango/{codigo}`** — lo baja `syncDepositosTango` (5:40, process 2941 de Redonhielo; los
códigos son los mismos en Rolito) + callable `sincronizarDepositosTangoAhora` (botón en Ajustes → Depósitos de
reparto): `{ codigo, nombre, idSta22, inhabilitado, actualizadoEn }` con merge. Campos editables desde el panel
(`src/components/admin/DepositosPanel.tsx`): `tipo` (repartidor / planta / interno; default 01-02 planta, 26 29 81
97 98 99 interno), `activo`, `uid` + `usuarioNombre` + `usuarioRol` (chofer o supervisor vinculado). Al vincular se
refleja `config/tango.depositos[uid] = codigo` (respaldo de los writers). Reglas: lectura `isStaff()`, update solo
de esos campos por `isOperator() || isManager()`. Migración inicial: `scripts/tango/migrar-depositos.mjs`
(62 depósitos, 8 choferes + Vinjoy y Vañek vinculados; "23 CRISTIAN GONZALEZ" ↔ "Cristian Gonzales" se vincula a
mano).

**Identidad en los docs** (`src/utils/depositos.ts`): `choferId` = uid del usuario vinculado o `dep:<código>` si
el depósito no tiene usuario. Así las consultas por `choferId + fecha`, los índices y las reglas de lectura del
chofer siguen iguales; el ID de liquidación sigue siendo `{fecha}_{choferId}`. Los docs de `remitosCarga`,
`descargasCamion`, `ventasCamion`, `cobranzas` y `liquidaciones` suman `depositoTango` / `depositoTangoNombre`.

**Pantallas**: carga (`RemitosCargaPage`) lista todos los depósitos de reparto activos ("21 · Primiterra
Cristian" o "33 · NOAIN 01 · sin usuario en la app"), primero los que ya tienen remito hoy. Muelle puede descargar
un remito del día o "otro depósito" sin remito (sin cuadre de pallets). Liquidación: selector de fecha (días
anteriores) + depósito, con los que salieron ese día primero. Venta del camión y cobranza guardan el depósito del
vendedor (el vinculado en el catálogo, o el del remito de carga de hoy). Supervisores con depósito ven "Vender" en
su inicio (`/supervisor/vender`, misma pantalla del chofer; regla de `ventasCamion` admite `isSupervisor()`).

**Writers**: `codigoDeposito()` (functions) y `depositoDe()` (bridge-sql) usan `payload.depositoTango` primero y
el mapa uid/camión → código como respaldo. `onRemitoCargaCreado` / `onDescargaCamionCreada` mandan
`depositoTango` en el payload (fase B de stock lo va a consumir). Pendiente: copiar `bridge-sql.mjs` al servidor.

## 28. Liquidación detallada como herramienta de control + historial (2026-09-06)

Maqueta aprobada por Ariel (artifact `1bd0e922`): la liquidación del repartidor muestra TODO lo que se bajó a
cada cliente, clasificado en bloques con subtotal — **Recorrido** (carga y descarga renglón por renglón), **Ventas
contado Redonhielo** (efectivo / transferencia), **Cuenta corriente Redonhielo**, **Promo Rolito**, **Cobranzas**
(Redonhielo / Rolito, por medio: efectivo, transferencia, cheques, retenciones) y **Cambios**. Cada venta lista los
artículos uno por renglón, su comprobante (factura ARCA / remito interno / factura X) con **Ver** y **Enviar**, el chip
de estado en Tango (nº de comprobante o error), el chip de stock (VPR) y la firma del cliente. Cada cobranza muestra
el medio, la factura imputada, el recibo (Ver / Enviar) y el nº de recibo en Tango.

- Clasificación pura: `clasificarReparto()` en `src/utils/liquidacion.ts` (tests en `clasificarReparto.test.ts`);
  `efectivoARendir` = contado efectivo + promo efectivo + cobranzas en efectivo. `problemas[]` marca facturas
  rechazadas/inciertas, Tango en error y ventas sin comprobante (chip en la barra de estado que filtra las filas).
- Comprobante de una venta: `src/utils/comprobanteDeVenta.ts` (`entregarComprobanteVenta`, `describirComprobante`,
  `estadoTangoVenta`), compartido por `VentasChofer`, la liquidación y Reparto en vivo del supervisor.
- Componentes: `src/components/expedicion/liquidacion/{DetalleReparto,ResumenLiquidacion,CierreLiquidacionModal}.tsx`.
- **Cierre con control**: si el efectivo recibido ≠ a rendir, motivo obligatorio (faltante del repartidor, vuelto
  mal dado, error de carga, otro) + nota → `Liquidacion.diferencia`; firma del repartidor en pantalla
  (`firmaRepartidor` dataURL + `firmanteRepartidor`, va al PDF); checkbox "el teléfono no muestra movimientos sin
  subir" → `confirmoSinPendientes`. **Limitación**: `hasPendingWrites` es por dispositivo, caja no puede detectar
  escrituras pendientes del teléfono del chofer, por eso es una confirmación y no un bloqueo duro. El cierre guarda
  además los ids de los docs (`ventasIds`, `cobranzasIds`, `remitosCargaIds`, `descargasIds`) y contadores para
  reconstruir el detalle al reimprimir.
- PDF: `generateLiquidacion(liq, detalle, { descargar })` devuelve blob (Enviar por WhatsApp/mail) con las tablas
  por bloque, motivo de la diferencia y firma.
- **Historial** `/caja/liquidaciones/historial` (caja, super_admin, gerente_general): mes × repartidor con cierres,
  a rendir, recibido, diferencia (rojo) y cantidad de cierres con diferencia; lista de cierres con motivo y quién
  cerró; cada fila abre `/caja/liquidaciones?fecha=…&repartidor=…` en modo lectura. Query
  `subscribeLiquidacionesEnRango` (rango sobre `fecha`, sin índice compuesto; planta filtrada en el cliente).
- Reglas: `liquidaciones` lectura suma `isSupervisor()` (Reparto en vivo muestra "cerrada"); create admite los
  campos nuevos. Tests en `tests/firestore-rules.test.js`.

## 29. Fase B del stock: remito de carga y descarga como transferencias en Tango (2026-09-06)

Pedido de Ariel ("tiene que estar sí o sí para mañana"): la carga al camión mueve el stock de la planta al
depósito del camión en Tango en el momento, y la descarga lo devuelve. Hasta hoy los items
`transferenciaDeposito` que encolan `onRemitoCargaCreado` / `onDescargaCamionCreada` quedaban en la cola sin
handler (en producción todavía no hay ningún remito de carga ni descarga: cola vacía, sin backlog).

- **Comprobantes**: carga = **CAR** (ID_STA13 145, transferencia 'T'), descarga = **DES** (146), los dos con el
  talonario **13 "TRASLADO ENTRE DEPOSITOS"** (STA17, sucursal 25, PROXIMO plano) y `TCOMP_IN_S = 'TI'`: son los
  mismos tipos que grababa Bluesoft (muestras `sql/muestras-stock-2026-09-04.json`) y la transferencia TRA de la
  traza del 05/09 usó el mismo talonario, así que el writer `transferenciaDeCargaDescarga` ya estaba probado.
- **Bridge** (`scripts/tango/bridge-sql.mjs`): handler `transferenciaDeposito`, flag `transferenciasSqlEnabled`.
  Depósito de la planta = `config/tango.depositosPlanta[plantaId]` (torcuato 01, merlo 02); depósito del camión =
  `payload.depositoTango` o `config/tango.depositos[uid|camionId]`, **nunca** el de la planta (error duro si falta
  o si coincide con la planta). Resultado `{ transferenciaNumero, tComp, idSta14, origen, destino }` → write-back
  `tango.transferenciaNumero` en el remito / la descarga (ya estaba en `onOutboxConfirmado`). `--probar-sql` chequea
  además INSERT en STA19, tipos CAR/DES y talonario 13.
- **Fila de saldo nueva**: si el depósito no tiene el artículo en STA19 (tercerizado en su primera carga), el writer
  hace `INSERT STA19 (FILLER, CANT_STOCK, COD_ARTICU, COD_DEPOSI, COD_UBIC1..3, UBIC_TXT)` — columnas tomadas del
  UPDATE de fila completa que hace Tango en la traza; los triggers completan ID_STA11 / ID_STA22. Vale para el
  destino (con la cantidad) y para el origen (en negativo, con aviso en el log). Permiso nuevo: `GRANT INSERT ON
  STA19` (`scripts/tango/sql/10-transferencias.sql`, que además lista los saldos por depósito para el inventario
  inicial).
- **Config**: `configurar-stock-tango.mjs --tipo carga tipo=transferencia tComp=CAR tcompInS=TI talonario=13`,
  ídem `descarga` con `tComp=DES`, y `--transferencias on` recién después de un `--dry-run --solo=<id>` sobre el
  primer remito real.
- Sigue pendiente de la fase B: cambios (CBS camión → 99), rotas en exceso (MER), ajuste de liquidación (AJU →
  98), producción (PDT/PRO) y el inventario inicial de plantas y camiones el día del corte.
