# Relevamiento: carga escaneada por pallet (borrador → escaneo → remito)

Fecha: 2026-09-17 (noche). Solo lectura del código al commit `7653af4`. No propone implementación: dice qué existe, dónde vive y qué habría que tocar para llegar al circuito nuevo.

**Circuito objetivo.** Ventanilla arma un borrador de carga (sin número, sin remito R, sin COT, sin stock). El que carga escanea los pallets por el QR de la etiqueta de producción (`DT-000006`). Al cerrar el escaneo nace todo junto: número, remito R, COT con hora real y transferencia planta → camión en Tango. Queda quién escaneó; si fue el chofer sin muelle, el remito queda marcado. Seguridad valida bultos en el portón. El stock de cámara pasa a ser producido − escaneado, en tiempo real.

Datos de producción al 17/09: 54 remitos de carga, 6 descargas contadas, 21 liquidaciones, **1 solo pallet de producción** (`DT-000006`, picado 10 kg, 80 unidades, 14/09).

---

## Resumen ejecutivo

**Lo que ya existe y se reusa tal cual o casi:** la entidad de pallet con su código único y sus unidades por producto, la etiqueta con QR en texto plano, el remito de carga con toda su cola aguas abajo (remito R, COT, CAR en Tango, muelle, seguridad, liquidación), la cola `tango-outbox` idempotente con dry-run, la tablet del muelle, la pantalla de seguridad, la persistencia offline de Firestore y la fase B del stock (ya prendida).

**Lo que hay que construir de cero:** el borrador de carga (no existe ningún estado previo a `emitido`), el lector de escaneo continuo (el único lector es one-shot y solo se usa en pañol de heladeras), la resolución de un DT escaneado (no hay consulta por `codigo` ni permiso de lectura para caja/muelle/chofer), el vínculo pallet ↔ remito (hoy el remito lleva cantidades declaradas, nunca códigos), la marca "pallet cargado" (el pallet es inmutable y no tiene estado), el stock de cámara (no existe), la confirmación del chofer (hoy solo puede escribir `regreso`), el conteo de bultos en seguridad (hoy solo confirma la salida) y el cierre del escaneo como transacción que emite el remito.

**La pieza crítica:** la tabla DT → producto y bolsas **existe** (es la propia colección `produccionPallets`, cada doc trae `productoId` y `unidades`), pero **no es consultable por código, no la puede leer nadie de expedición y tiene un solo registro real**. Sin producción cargando pallets todos los días, no hay nada que escanear.

---

## A. Remito de carga actual

**A1. Dónde se emite.** Una sola pantalla, `src/pages/logistica/expedicion/RemitosCargaPage.tsx` (ruta `/caja/remitos`, rol caja). Servicio `src/services/remitoCargaService.ts` → `crearRemitoCarga()` (líneas 54-103), todo en una `runTransaction` con los contadores `config/cargaCounter_{planta}` (número interno) y `config/remitoCargaCounter` (remito R oficial, con tope por CAI). Código `RC-DT-000040` (`codigoRemitoCarga`). Auxiliares: `components/expedicion/CotCargaForm.tsx`, `RacksInput.tsx`, `utils/cot.ts`, `utils/envases.ts`, `utils/helpers.ts:palletsInfo`.

**A2. Qué dispara la emisión hoy.** Dentro de la transacción: número interno, remito R (si `config/cot.respaldo.numeraLaApp` y CAI vigente; el número se inyecta en `cotSolicitud.respaldo`), `estado: 'emitido'`, `tango: { estado: 'pendiente' }`, `kg`, `cotSolicitud`. Después, dos Cloud Functions `onDocumentCreated` sobre `remitosCarga/{id}`:

| Efecto | Dónde | Cuándo |
|---|---|---|
| COT de ARBA | `functions/src/triggers/cotArba.ts:87` `onRemitoCargaCotSolicitado` → escribe `remitosCarga.cot` | al crear el doc, si nació con `cotSolicitud` |
| Stock planta → camión (CAR) | `functions/src/triggers/tangoOutbox.ts:323` `onRemitoCargaCreado` → item `remitosCarga_{id}` en `tango-outbox`, `sentido: 'carga'` | al crear el doc |
| Muelle / seguridad | `functions/src/triggers/muelleEstado.ts:32` recalcula `muelleEstado/{planta}`; las pantallas se suscriben a `remitosCarga` del día | al escribir el doc |
| PDF | `RemitosCargaPage.confirmar()` imprime `utils/remitoCargaOficialPdf.ts` (remito R "PARA REPARTO") o `utils/pdf.ts:generateRemitoCarga`; si hay COT espera hasta 25 s a ARBA (`esperarCotRemito`) | en la misma acción de caja |
| Liquidación | nada se escribe. El vínculo es implícito: `liquidaciones/{fecha}_{choferId}` con la fecha del remito. El estado `'liquidado'` del remito está declarado y **nadie lo escribe** | — |

**A3. COT.** Lo genera **la app**, no Tango (Tango solo hace COT de sus propios remitos y la carga viaja como transferencia). `functions/src/triggers/cotArba.ts:presentarCotDeRemito` arma el TXT (`functions/src/services/arba/cot.ts`, registros 01-04, ISO-8859-1) y lo presenta por POST multipart al web service de ARBA (`functions/src/services/arba/cotHttp.ts`, CUIT + secret `ARBA_CIT`, timeout 40 s). Config en `config/cot` (umbral 4.500 kg o importe, `bloqueaSalida`, respaldo 091/00025). Reintento solo manual (callable `presentarCotRemito`, botón en la pantalla). Docs: `docs/arba/COT.md`.

**A4. Quién puede emitirlo.** Reglas `firestore.rules:1105-1221`. `create` solo `isCajaDe(plantaId)` (caja de esa planta o super_admin), con `estado == 'emitido'`, `items` no vacío, `palletsCarga` coherente con envases, `remitoR` bien formado y **sin `cot`** (solo el server). `update`: muelle (`emitido → entregado`, dársena), seguridad (`entregado → salido`, regreso), chofer (`regreso` y `regreso.darsena`, **una sola cláusula por el tope de 1000 expresiones**). Caja no puede editar nada después. `delete: false`. Rutas en `src/rutas/catalogo.ts:141` (`CAJA = ['caja','super_admin']`). Tests en `tests/firestore-rules.test.js` desde la línea 2314.

**A5. Borrador.** **No existe.** El remito nace `emitido` y el número se consume en la misma transacción. Los únicos "borradores" del repo son de otros dominios (despachos, usuarios, preventivos de heladeras).

## B. Modelo de datos

**B6. `RemitoCarga`** (`src/types.ts:285-352`): `numero`, `codigo`, `plantaId`, `camionId` (puede ser `manual:<PATENTE>`), `camionLabel`, `choferId` (uid o `dep:<código Tango>`), `choferNombre`, `depositoTango`, `items[]`, `palletsCarga`, `envases {tarimasMadera, palletsMetal, racks[]}`, `estado: 'emitido'|'entregado'|'salido'|'liquidado'`, `darsena`, `darsenaAsignadaEn`, `creadoPor`, `fecha`, `entregadoPor`, `salida`, `regreso {uid,nombre,hora,darsena?}`, `tango {estado, transferenciaNumero}`, `kg`, `cotSolicitud`, `cot`, `remitoR {puntoVenta, numero, cai, vencimiento}`. Índices: `(plantaId, fecha)` y `(choferId, fecha)`.

**B7. Líneas.** `items[] = { productoId, nombre, cantidad, pallets? }`: cantidad en bolsas y un número de pallets **declarado por caja** (sugerido por `unidadesPorPallet` del catálogo, `utils/helpers.ts:palletsInfo`). `palletsCarga` es la suma de tarimas de madera y pallets de metal (envases retornables), no una lista. **No hay ningún código de pallet en el remito.** El remito real más nuevo: `[{bolsa_3kg, 630, pallets: 2}, {anticorrosivo, 110, pallets: 1}, …]`, `palletsCarga: 4`.

**B8. Lectores de `remitosCarga`.** Caja (`RemitosCargaPage`), muelle tablet (`MuelleDashboard`: entregar, dársena, precarga de la descarga), TV del muelle (`MuelleTvPage`), seguridad (`SeguridadDashboard`), liquidación (`LiquidacionesPage`, `utils/liquidacion.ts:calcularLiquidacion`), liquidaciones abiertas (`utils/liquidacionesAbiertas.ts`), reparto y tesorería en vivo (`services/repartoEnVivoService.ts`, `utils/tesoreriaLive.ts`), tiempos del muelle (`utils/metricasMuelle.ts`), chofer ("Mi carga de hoy", `AvisarRegreso`, y de ahí sale el `depositoTango`/`camionId` del día para vender), backoffice (conteo de COT). Server: `tangoOutbox.ts` (CAR, `diaReparto` de la descarga, write-back), `cotArba.ts`, `muelleEstado.ts`, `descargaRevision.ts`.

## C. Pallets y escaneo

**C9. Entidad de pallet: sí.** `produccionPallets`, tipo `PalletProduccion` (`src/types.ts:1697`): `codigo` (`DT-000006`, prefijo de planta + correlativo de `config/produccionCounter_{planta}`), `numero`, `plantaId`, `productoId`, `productoNombre`, `unidades` (bolsas del pallet, del catálogo: 10 kg = 88, 3 kg = 315, 2 kg = 460, picado = 80, escama = 70, barras = 56, cementera = 88), `operador`, `fechaFabricacion`, `createdAt`. Servicio `src/services/produccionService.ts:crearPallet` (offline-first, con lotes de números reservados en localStorage). **Inmutable** por reglas (`allow update, delete: if false`, `firestore.rules:986-1006`). **No tiene estado**: no existe "en cámara", "cargado", "anulado". **No hay vínculo con el remito ni con Tango** (el trigger `onProduccionPalletCreado` encola `produccionPallet` pero el writer es un stub en `bridge-listener.mjs`, y el tipo PDT/PRO de Tango sigue "a mano"). No hay concepto de lote.

**C10. Lectura de QR.** Una sola librería y un solo componente: `@zxing/browser` en `src/components/heladeras/BarcodeScanner.tsx` (57 líneas), `decodeOnceFromVideoDevice` → lee **un** código y cierra el modal. Se usa **solo en pañol de heladeras** (`PanolPage.tsx`). No hay `BarcodeDetector`, ni `html5-qrcode`, ni fallback a `<input capture>` o a tipeo manual. **Sobre iOS/Safari no hay ni una línea**: ningún manejo, comentario ni memoria. El QR del pallet lleva el código en texto plano (pedido explícito, `FichaPalletPage.tsx:10-12`); los otros dos QR de la app (heladeras, turnos) llevan URL y se leen con la cámara nativa del teléfono.

**C11. Escaneo de 6 a 10 seguidos.** La implementación actual **no sirve**: es one-shot, sin modo continuo, sin cola, sin deduplicación, sin feedback sonoro ni háptico. Hay que hacer un lector nuevo.

## D. Producción

**D12. Roles y pantallas.** `produccion_hielo` (operario, subrol `maquinista`) y `produccion_encargado`. Tablet fijada por dispositivo (`produccionDeviceService`), login legajo + PIN (`produccionAuthService`). Pantallas en `src/pages/logistica/produccion/`: grilla de carga (`ProduccionDashboard`, doble toque por producto → pallet + etiqueta), maquinista, partes de máquinas, resumen, listado, operarios, plantas, ticket, ficha. Rutas `catalogo.ts:107-109, 162-169`.

**D13. Granularidad.** **Pallet por pallet**, con producto y unidades. Más el parte de máquinas por turno. Resumen del encargado por período, planta y producto.

**D14. Etiquetas.** Las emite **la propia app**: ZPL a la Zebra ZD421 por Web Bluetooth (`utils/zplPallet.ts`, `services/zebraBleService.ts`, `hooks/useImpresoraZebra.ts`) o ticket HTML de respaldo (`components/produccion/ProduccionTicket.tsx`). QR y Code 128 con el código en texto plano. No hay sistema externo.

**D15. Tabla DT → producto y bolsas.** **Existe: es `produccionPallets`.** Cada doc trae `productoId`, `productoNombre` y `unidades`. Pero, y esto es lo crítico:
- **No es consultable por `codigo`**: ningún servicio hace `where('codigo', '==', …)`; el acceso puntual es por id de documento autogenerado, que no es el DT. Falta la consulta (índice de campo simple alcanza, Firestore lo crea solo) o bien usar el código como id del doc.
- **No la puede leer expedición**: `allow read` solo para producción, `super_admin`/`gerente_comercial`/`comercial` (`isManager()`), gerente general, logística y encargado. **Caja, muelle, seguridad y chofer están afuera.**
- **Tiene un registro.** La producción con tablet todavía no arrancó (Zebra sin definir, Merlo sin contador). Sin pallets cargados en planta, el escaneo no tiene qué resolver.
- No hay ningún campo que diga si el pallet sigue en cámara o ya subió a un camión.

## E. Tango

**E16. Cómo escribe la app.** Cola `tango-outbox` (`functions/src/triggers/tangoOutbox.ts`): un trigger por colección encola con id determinístico y `.create()` (idempotente), estados `pendiente → enviado → confirmado | error` (5 intentos), write-back `onOutboxConfirmado` por dot-paths. Dos caminos:
- **Tango Connect (HTTPS)**: `functions/src/services/tango/client.ts`, secret `TANGO_API_TOKEN`, headers `ApiAuthorization` + `Company`, worker `tangoWorker.ts` (claim atómico en transacción, barrido cada 15 min). Solo remito de venta, factura y NC.
- **SQL directo por el bridge de la VM**: `scripts/tango/bridge-sql.mjs` (usuario `rolito_bridge`, `onSnapshot` + barrido cada 5 min, transacción por comprobante, `--dry-run`, `--solo`, `--probar-sql`, interruptores generales y por tipo). Recibos, egreso promo y **todas las transferencias de depósito**. Writers en `functions/src/services/tango/sql/*.ts` (copiados a `C:\RolitoSync\sql\lib`).
- Idempotencia en Tango por `LEYENDA1` (`ROLITO:RC:<id>` para la carga). Sin `buildError` para transferencias: si un item muere en `error`, el remito queda `tango.estado: 'pendiente'` para siempre. Reencolar: `scripts/tango/reintentar-outbox.mjs`. Monitoreo: Panel de control (`/admin`, conteos + latido del bridge, umbral 5 min).
- **No existe contra-movimiento** de una transferencia (ni anulación, ni reversa, ni estado cancelado). Rectificar una descarga o anular un remito de carga hoy es trabajo manual de la oficina.

**E17. Fase B.** **En producción y prendida desde el 17/09 a la noche** (§36 de `docs/tango/INTEGRACION.md`). Disparadores hoy: merma → `onDescargaCamionCreada` (rotas de la descarga, camión → 99, CAM talonario 6; primeros reales CAM 111 y 112); diferencia → `onLiquidacionCerrada` (`carga − ventas − rotas − descarga`, camión → 98, DIF talonario 13, solo si hay `descargasIds` y no es cierre de arranque); cambio de ventanilla → `encolarVenta` (planta → 99). Y `ventaPromo.incluyeCambios = false`. Cálculo puro en `functions/src/services/diferenciasReparto.ts`.

**E18. Si el CAR pasa a dispararse al escanear, qué se rompe.** Nada se rompe *solo* si el escaneo termina creando el mismo doc `remitosCarga` con la misma forma: todo lo de aguas abajo escucha `onDocumentCreated` de esa colección. Lo que sí queda acoplado y hay que mirar:
1. `onRemitoCargaCreado` toma el snapshot **del alta**: `items`, `envases`, `depositoTango`. Un remito que nace del escaneo tiene que nacer ya con los items definitivos (los del escaneo), no con los del borrador.
2. Id determinístico `remitosCarga_<id>` + `.create()`: un solo movimiento por remito, para siempre. Si el borrador y el remito fueran el mismo doc que cambia de estado, el trigger de creación dispararía con el borrador vacío. **El borrador tiene que ser otro doc u otra colección**, o el trigger tiene que pasar a `onDocumentWritten` con condición de estado (y entonces la idempotencia por id sigue valiendo).
3. El COT (`onRemitoCargaCotSolicitado`) y el remito R (numerado en la transacción de `crearRemitoCarga`) comparten ese mismo instante. Con el escaneo, la hora real de salida es la del cierre del escaneo, que es lo que se quiere.
4. `muelleEstado`, liquidación (`{fecha}_{choferId}` con la `fecha` del remito), liquidaciones abiertas, `diaReparto` de la descarga y "Mi carga de hoy" del chofer dependen de `fecha`, `plantaId`, `choferId`, `camionId` del remito. Si el borrador se arma el día anterior, **la `fecha` del remito tiene que ser la del cierre del escaneo**, no la del borrador.
5. Reglas: `create` de `remitosCarga` es solo caja. Si el que cierra el escaneo es muelle o chofer, hace falta una regla nueva de creación para esos roles (o una callable/transacción del server). El chofer tiene una única cláusula de update por el tope de 1000 expresiones: agregarle escrituras es delicado.
6. El writer de Tango ignora `envases` y falla si un producto no tiene mapeo en `config/tango.articulos`. Con el escaneo, los productos salen del catálogo de producción (`produccionCatalogo.ts`, 7 ids como `bolsas_3kg_rolito`, `picado_10kg`), **que no son los mismos ids que el catálogo de ventas** (`bolsa_3kg`, `bolsa_10kg`). Hay que mapear producto de producción → producto de venta o el CAR no sale.

## F. Offline

**F19. Service worker.** `src/sw.ts` con `injectManifest`: precache del build (incluido jspdf, para facturar en la calle), `navigateFallback` al app-shell, `StaleWhileRevalidate` para los chunks pesados (entre ellos `BarcodeScanner`, que **no se precachea**: si nunca se abrió con señal, no está), `CacheFirst` para imágenes, push. Ningún dato de Firestore o Functions se cachea en el SW.

**F20. Chofer offline.** Sí opera: Firestore con `persistentLocalCache` + `persistentMultipleTabManager` (`src/services/firebase.ts:71`). No hay cola propia: encola Firestore (pending writes). La app le pone encima `fireAndForget` (ventas, cobranzas, pallets) y `esperarOEncolar` de 4 s (descarga, salida, regreso, entregas) en `src/services/observability.ts`, más el indicador "sin subir" por `metadata.hasPendingWrites`. La numeración interna de comprobantes se resuelve sin red con lotes reservados en localStorage (`numeracionInternaService`); la firma viaja base64 dentro del doc. Requieren red: transacciones (`crearRemitoCarga`, `cerrarLiquidacion`, reservar lote), callables (COT, mail, PIN) y Storage.

**F21. Escanear a las 5 AM sin señal.** La arquitectura **soporta a medias**:
- Resolver un DT offline es viable con la caché de Firestore **si la colección de pallets en cámara ya bajó al dispositivo con señal** (una suscripción acotada, tipo `useSharedSubscription` sobre pallets no cargados de la planta). Hoy no existe esa suscripción, ni el permiso, ni la consulta por código.
- Guardar los escaneos offline es viable (pending writes).
- **Cerrar el escaneo y emitir el remito offline no es viable hoy**: numerar (`cargaCounter`, `remitoCargaCounter` con tope de CAI) es una transacción, y el COT es una callable a ARBA. Habría que separar "escaneo cerrado" (offline, encolado) de "remito emitido" (lo emite el server cuando llega, o el dispositivo cuando recupera señal), y aceptar que el remito R y el COT salgan minutos después de que el camión arrancó, o retener al camión hasta tener señal.
- El chunk del lector no está precacheado. Hay que moverlo al precache.

## G. Liquidación y muelle

**G22. Liquidación.** **Sigue cerrando plata y mercadería juntas**, en un doc y un botón (`LiquidacionesPage.tsx:371` → `CierreLiquidacionModal` → `cerrarLiquidacion`). El doc guarda `productos[]` (carga, ventas, cambios, rotas, devolución teórica, descarga, diferencia), `porEmpresa`, `conteoBilletes`, cheques/retenciones tildados, dos firmas, `desvio`, `descargasIds`. Inmutable salvo `entregaId`. No existe ningún estado ni campo de separación (`soloPlata`, `cierreMercaderia`: cero resultados). La propuesta de separación está aprobada en definiciones pero sin OK final ni código (`https://claude.ai/artifact/1j8qEXG53zHnEQxZGXnwv9`). Once lectores preguntan "¿ya se liquidó?" por la existencia de `liquidaciones/{fecha}_{uid}` (tres en reglas: anulación de remito por el chofer, de factura del camión, de recibo).

**G23. Muelle.** `MuelleDashboard.tsx` (707 líneas), todo manual y táctil, sin escaneo. Carga: toca el remito, asigna dársena (`darsena` + `darsenaAsignadaEn`) y "Mercadería entregada" pasa el remito **entero** a `entregado` (sin conteo por pallet ni por producto). Descarga: elige el remito del viaje (hoy y ayer), cuenta a ciegas solo los productos de ese remito más "Otro producto", rotas y envases, `diaReparto` = día del remito, rectificación por doc nuevo con `rectificaA`. El server calcula la `revision` (`descargaRevision.ts`) y encola DES y merma. TV: cuatro zonas (dársenas 5→1, ventanilla, "volvieron", "siguen"); la "anticipación de cámara" es la cola de los próximos tres turnos de ventanilla, no un stock.

**G24. Seguridad.** **Existe**: `SeguridadDashboard.tsx` (`/seguridad`, 207 líneas). Muestra los remitos `entregado` con remito R, COT (verde/rojo), items y `palletsCarga`; un toque "Salió ✓" escribe `estado: 'salido'` + `salida {uid,nombre,hora}`; botón "Volvió" escribe `regreso`. **No cuenta bultos**: no hay input ni comparación. El bloqueo por COT (`bloqueaSalida`) es solo de UI, las reglas no lo exigen. Para una validación mínima de bultos hace falta: un campo de conteo por producto o total en `salida`, la regla que lo exija con `hasOnly`, y la comparación contra `items` en pantalla (y contra los pallets escaneados, cuando existan).

---

## Qué ya existe y se reusa

| Pieza | Dónde | Estado |
|---|---|---|
| Pallet con código único, producto y unidades | `produccionPallets`, `PalletProduccion`, `crearPallet`, contador por planta | Listo. Le faltan estado, consulta por código y permisos |
| Etiqueta con QR en texto plano | `utils/zplPallet.ts`, Zebra por Bluetooth, ticket HTML de respaldo | Listo |
| Remito de carga y toda su cola | `crearRemitoCarga`, remito R, COT, CAR en Tango, `muelleEstado`, PDF | Listo. El escaneo tiene que terminar creando este mismo doc |
| Cola a Tango idempotente | `tango-outbox`, bridge con dry-run y `--solo`, reintentos, panel | Listo |
| Fase B del stock | merma → 99, diferencia → 98, cambio de ventanilla → 99 | En producción desde el 17/09 |
| Tablet del muelle | `MuelleDashboard` (dársena, entrega, descarga ciega, rectificación) | Listo; le falta el escaneo |
| Pantalla de seguridad | `SeguridadDashboard` (salida, regreso, COT) | Listo; le falta el conteo |
| Offline | `persistentLocalCache`, `fireAndForget`, `esperarOEncolar`, lotes de numeración en localStorage | Listo para guardar; no para numerar ni para COT |
| Lector de QR | `BarcodeScanner.tsx` con `@zxing/browser` | Solo sirve de punto de partida: es one-shot |
| Liquidaciones abiertas | `utils/liquidacionesAbiertas.ts` | Ya separa mercadería sin devolver de efectivo sin rendir, solo lectura |

## Qué hay que construir de cero

1. **Borrador de carga**: colección o estado nuevo (`cargasPlanificadas` o `remitosCarga.estado: 'borrador'` en un doc aparte), sin número, editable por caja/logística, con vencimiento, invisible para seguridad, liquidación y Tango. Reglas y tests.
2. **Sesión de escaneo**: lista de pallets escaneados asociada al borrador, con quién escanea, cuándo, duplicados rechazados, pallet de otra planta o ya cargado rechazado, "pallet suelto / bolsas sueltas" para lo que no viene paletizado (agua, bidones, anticorrosivo: hoy la mitad de los items del remito no son pallets de producción).
3. **Lector de escaneo continuo**: componente nuevo (zxing o `BarcodeDetector` con fallback), modo continuo, deduplicación, sonido y vibración, entrada manual del código, y funcionamiento probado en iOS dentro de la PWA instalada.
4. **Resolución del DT**: consulta por `codigo` (o el código como id del doc), permiso de lectura para caja/muelle/chofer/seguridad acotado a pallets de su planta, y suscripción a "pallets en cámara" de la planta para tenerla en caché offline.
5. **Estado del pallet**: `cargadoEn {remitoId, fecha, uid}` escrito solo por el server al cerrar el escaneo (hoy es inmutable por reglas; conviene que siga inmutable para el cliente y lo marque una function).
6. **Cierre del escaneo → remito**: transacción o Cloud Function que arma `items` desde los pallets (producto de producción → producto de venta, unidades × pallets), crea el `remitosCarga` con la forma actual (número, remito R, `cotSolicitud`, `escaneadoPor`, marca `sinMuelle`), marca los pallets como cargados y borra o cierra el borrador. Si lo cierra un rol que hoy no puede crear remitos, va por callable.
7. **Mapeo producto de producción ↔ producto de venta ↔ artículo de Tango** (`produccionCatalogo.ts` vs `catalogo` vs `config/tango.articulos`). Hoy son tres mundos con ids distintos.
8. **Confirmación del chofer** (modo sin muelle): pantalla en su app, regla de escritura nueva (ojo al tope de 1000 expresiones: probablemente por callable).
9. **Conteo de bultos en seguridad**: campo en `salida`, regla, UI de comparación contra el remito.
10. **Stock de cámara**: vista derivada `pallets producidos − pallets cargados` por planta y producto (agregado incremental por trigger, tipo `rollupsPedidos`, para no leer toda la colección), y su pantalla (encargado de producción, TV del muelle).
11. **Anulación o reversa de una carga escaneada mal** (hoy no existe contra-movimiento en Tango ni edición del remito).

## Piezas bloqueantes, por criticidad

1. **Producción no está cargando pallets.** Un solo pallet real. Sin etiquetas pegadas en cámara todos los días (las dos plantas, todos los productos que van en pallet), no hay qué escanear. Depende de la Zebra (modelo y rollo sin definir), del contador de Merlo y de que los operarios adopten la tablet. Es organizativo, no de código, y es lo primero.
2. **`produccionPallets` no es consultable ni legible por expedición.** Sin la consulta por código y el permiso, ningún escaneo resuelve nada. Chico de hacer, pero bloquea todo.
3. **Mapeo de productos de producción a productos de venta y a artículos de Tango.** Sin esto el remito no se arma y el CAR no sale. Además la mitad de lo que sube al camión (agua, bidones, anticorrosivo, hielo suelto) no tiene pallet de producción: hay que decidir cómo entra al remito lo que no se escanea.
4. **Escaneo en iOS dentro de la PWA.** No hay ninguna experiencia previa en el repo. Si los choferes usan iPhone, hay que probarlo antes de diseñar nada más (ver riesgos).
5. **Emisión offline del remito.** Numeración con tope de CAI y COT son online. Hay que decidir si el camión espera señal o si el remito se emite después (con el COT fuera de hora real, que es justo lo que se quiere evitar).
6. **Borrador vs trigger de creación del remito.** Si el borrador y el remito comparten doc, `onRemitoCargaCreado` dispara con el borrador. Decisión de modelo antes de tocar código.
7. **Separación plata/mercadería de la liquidación**: no bloquea el escaneo, pero el cierre por descarga contada y la diferencia → 98 al cerrar mercadería (propuesta pendiente de OK) cambian el mismo circuito. Conviene decidir el orden.

## Riesgos técnicos concretos

**Offline.**
- Resolver DT sin señal exige que la lista de pallets en cámara haya bajado antes con señal, y con una suscripción acotada (por planta, no cargados). Si la tablet del muelle o el teléfono del chofer se instala nuevo a las 5 AM sin red, no resuelve nada.
- Dos dispositivos escaneando el mismo pallet sin señal no se ven entre sí: la deduplicación fuerte solo se puede hacer en el server al cerrar. El cliente puede rechazar duplicados locales y pallets ya marcados en caché, nada más.
- La transacción de numeración y el COT no funcionan offline. Un cierre "encolado" que el server complete al llegar cambia la hora real del COT y deja al camión saliendo sin remito R impreso.
- El chunk del lector no está en el precache del service worker.

**Escaneo en iOS.**
- Safari en PWA instalada (standalone) tuvo durante años problemas con `getUserMedia` (cámara negra, permiso que no persiste, stream que muere al cambiar de pestaña). Mejoró desde iOS 16 pero hay que probarlo en los teléfonos reales de los choferes. `BarcodeDetector` no existe en Safari: zxing en JS es el camino, con más consumo de batería.
- Leer 6 a 10 códigos seguidos con guantes, a las 5 AM, con poca luz y el QR a 25 mm: hay que probar distancia, foco y tamaño del QR. La etiqueta actual se calibra contra el rollo real (todavía no se hizo).
- Alternativa robusta si la cámara falla: lector Bluetooth de mano (HID, tipea el código) sobre la tablet del muelle. No requiere código nuevo del lado del lector.

**Tango.**
- Sin contra-movimiento: una carga escaneada mal que ya generó el CAR se corrige a mano en Tango. Con el escaneo el volumen de correcciones puede subir al principio.
- Un producto sin mapeo en `config/tango.articulos` manda el item a `error` y el remito queda `pendiente` sin aviso (no hay `buildError` para transferencias).
- Los depósitos de los camiones ya están muy lejos de la realidad (camión 06 en −11.719 bolsas de 3 kg, camión 03 en −8.707 de 2 kg). Cualquier control por stock de camión en Tango es inútil hasta la regularización.
- Producción a Tango (PDT/PRO) es un stub: el stock de cámara en Tango no sube con los pallets. El "stock de cámara en tiempo real" del objetivo vive en la app, no en Tango, hasta que se escriba ese writer.

**Reglas.**
- El chofer tiene una única cláusula de update por el tope de 1000 expresiones. Darle escrituras nuevas (confirmar carga) sobre `remitosCarga` es riesgoso; mejor por callable o sobre otra colección.
- El borrador editable por varios roles y el remito inmutable tienen que ser docs distintos para no aflojar la inmutabilidad actual.

**Datos.**
- El código DT se genera en el cliente con lotes reservados; dos tablets con lotes distintos no colisionan, pero una tablet con el lote agotado y sin señal frena la producción (`ReservaAgotadaError`). Con el escaneo aguas abajo, cada pallet sin etiqueta es un pallet que no se puede cargar.

## Estimación gruesa por bloque

Días de trabajo de desarrollo, sin contar pruebas en planta ni tiempos de decisión. Los bloques 1 y 2 son la base y no dependen de decisiones abiertas.

| Bloque | Qué incluye | Estimación |
|---|---|---|
| 1. Pallets consultables | consulta por código, permisos por planta para expedición, suscripción "en cámara" con caché, estado `cargadoEn` escrito por el server, índice | 1 a 2 días |
| 2. Mapeo de productos | producción ↔ venta ↔ Tango en config, validación, pantalla en Ajustes | 1 día |
| 3. Borrador de carga | colección, reglas, pantalla de ventanilla (armar, editar, vencer), lista para el muelle y el chofer | 3 a 4 días |
| 4. Lector continuo | componente nuevo, dedupe, sonido, entrada manual, precache, prueba en iOS y Android reales | 2 a 3 días, más 1 de pruebas en planta |
| 5. Sesión de escaneo y cierre | escaneos encolables offline, bolsas sueltas, cierre por callable que emite el remito con la forma actual, marca pallets, `escaneadoPor`/`sinMuelle` | 4 a 5 días |
| 6. Chofer confirma sin muelle | pantalla en su app, callable, marca en el remito y aviso a ventanilla | 2 días |
| 7. Seguridad cuenta bultos | campo, regla, UI de comparación, tests | 1 a 2 días |
| 8. Stock de cámara | agregado incremental por trigger, pantalla, zona en la TV | 2 a 3 días |
| 9. Reversa de una carga | anulación del remito escaneado + contra-movimiento en Tango (nuevo writer) | 3 días, con traza SQL previa |
| 10. Ajustes aguas abajo | `fecha` del remito = cierre del escaneo, `onRemitoCargaCreado` con items del escaneo, TV, liquidaciones abiertas, PDF con pallets | 2 días |

**Total desarrollo: 21 a 27 días**, más pruebas en planta y el arranque real de producción con etiquetas, que es la condición previa a todo.

## Decisiones que hay que tomar antes de codear

1. ¿El borrador vive en otra colección o es un estado del remito? (Recomendación implícita del relevamiento: otra colección, para no tocar la inmutabilidad ni el trigger de creación.)
2. ¿Qué pasa con lo que no viene en pallet de producción (agua, bidones, hielo suelto)? ¿Se tipea como hoy o se etiqueta también?
3. ¿El camión puede salir sin señal? Si sí, ¿el remito R se imprime después y el COT sale con la hora del server?
4. ¿Quién escanea en el modo normal: el muelle con la tablet, o siempre el que carga con su teléfono?
5. ¿Lector de cámara o lector Bluetooth de mano para la tablet del muelle?
6. ¿Se hace antes o después la separación plata/mercadería de la liquidación? Comparten el circuito.
7. ¿Cuándo arranca producción a etiquetar en las dos plantas? Es la pieza uno.
