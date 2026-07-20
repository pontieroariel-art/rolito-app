# Integración Rolito App ↔ Tango Gestión

> Documento maestro de la integración. Acá se destila todo el conocimiento del "mundo Tango"
> aplicado a esta app: licencias, API, mapeo de datos, arquitectura y preguntas abiertas.
> Se actualiza a medida que llegan documentos, exportes y respuestas de Axoft.
>
> Última actualización: 2026-07-19

## 1. Contexto y decisión de timing

- La empresa (REDONHIELO S.A., CUIT 30-69766897-3) usa Tango Gestión en producción, llave `001174/003`, versión 21.1.0.3185 (sin soporte; Axoft va por T25/Delta 5).
- **Delta 6 sale en 1-2 meses** (dicho por Axoft, jul 2026) con cambios significativos.
- **Decisión (2026-07-19):** no pagar la llave testing de 90 días hasta que Delta 6 esté disponible. Mientras tanto se desarrolla todo lo que no depende de la versión instalada (ver §4), porque la integración va por la **API cloud de Tiendas**, cuyo contrato no cambia con las tablas internas de cada versión de escritorio.
- Plan general: sandbox en la nube (llave testing + VM) → validar integración → recién después migrar el Tango productivo. Ver presupuestos y alternativas (Axoft / BETA connect / TC Cloud) en las notas del proyecto.

## 2. Licencias — qué hay y qué falta confirmar

Según factura Axoft A00006-00260794 (04/12/2025), la llave `001174/003` incluye:

| Código | Ítem | Estado |
|---|---|---|
| TSGPPA15GD | Extensión VE+CO+TE+CF+CN+SU+CH, 15 puestos Gold | Pagada |
| CT MUGD | Extensión Central Multiusuario Gold | Pagada |
| **TSAABMMUGD** | **Extensión API ABMs y Consultas Live** | **Bonificada ($0) — YA ACTIVA en la licencia** |
| CSNEXO | Apps Nexo gratuitas | Incluidas |

**Pregunta crítica abierta (Silvina, Axoft):** ¿la "Extensión API ABMs y Consultas Live" es lo mismo que la **API de Tango Tiendas** (REST cloud, requiere licencia "Tango Tiendas Full" + módulo tesorería según la doc), o es otra API distinta (local, tipo ABM)? De la respuesta depende el camino técnico. Segunda pregunta: si la llave testing pagada post-lanzamiento se genera directo en Delta 6.

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

1. **[CRÍTICA]** ¿"Extensión API ABMs y Consultas Live" (ya en la llave) = Tango Tiendas API? ¿O hace falta contratar "Tango Tiendas Full"? → Silvina.
2. ¿La llave testing post-Delta 6 se genera directo en Delta 6? ¿Fecha comprometida de salida? → Silvina.
3. ¿Quién habilita/configura Nexo Tiendas + AccessToken en el sandbox? (no está en el alcance de TC Cloud ni de BETA connect) → definir antes de contratar.
4. Numeración: ¿`OrderNumber` lo definimos nosotros o Tango exige talonario (`OrderCounterfoil`)? → probar en sandbox.
5. ¿Qué `SaleConditionCode` usar por cliente? (condición de venta vive en Tango) → export de clientes.
6. ¿La conversión de base T21 → Delta 6 es directa o escalonada? → Axoft/implementador.

## 7. Material pendiente de recopilar (Ariel)

- [ ] Export Excel de **clientes** de Tango (código, razón social, CUIT, lista de precios, vendedor, condición de venta, categoría IVA) — alcanza una muestra.
- [ ] Export Excel de **artículos** (código, descripción, unidades de medida).
- [ ] Export de **listas de precios** (números y nombres de lista + precios).
- [ ] Capturas de pantalla: ABM cliente, ABM artículo, carga de pedido, factura.
- [ ] Circuito contado por quien opera: cómo entra un pedido hoy, cómo se factura, qué pasa al cancelar.
- [ ] Respuestas de Silvina (preguntas 1-2 de §6).
- [ ] Manuales/PDFs que tenga el implementador sobre la extensión API.

> Dejá todo en `docs/tango/material/` (crear la carpeta al primer archivo) y avisá — se procesa y se vuelca acá.
