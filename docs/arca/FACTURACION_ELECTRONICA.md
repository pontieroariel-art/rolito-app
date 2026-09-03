# Facturación electrónica ARCA (WSFEv1) — relevamiento

> Fuente: manual oficial **"Facturación RG 4291 – Proyecto FE v4.8"**, revisión del 1/12/2026
> (202 páginas), descargado de `https://www.afip.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf`.
> Relevado el 2026-09-01. Este documento es la fuente de verdad de la integración con ARCA;
> para la integración con Tango ver `docs/tango/INTEGRACION.md`.

## 1. Para qué

Decisión de Ariel (2026-09-01): cuando el chofer registra una venta de **canal contado**, la app
debe emitir la **factura electrónica real** — conectarse a ARCA, obtener el CAE y generar el
comprobante para entregarle al cliente. El traslado de esas facturas a Tango es una **fase
posterior**, explícitamente fuera de alcance por ahora.

Esto convierte a Rolito app en un **facturador electrónico**, con la responsabilidad fiscal que
eso implica. No es un cambio menor: hasta hoy la facturación vivía enteramente en Tango.

## 2. Cómo funciona el servicio

Son **dos** web services SOAP encadenados:

1. **WSAA** (autenticación) — se le manda un "Ticket de Requerimiento de Acceso" (TRA) firmado
   digitalmente con un certificado X.509, y devuelve un **Token + Sign** con **12 horas** de
   validez. El TRA debe pedir el servicio con el tag `service` = **`wsfe`**.
2. **WSFEv1** (negocio) — cada llamada lleva `Auth { Token, Sign, Cuit }` y devuelve el CAE.

**URLs:**

| Ambiente | WSFEv1 |
|---|---|
| Homologación (pruebas) | `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` |
| Producción | `https://servicios1.afip.gov.ar/wsfev1/service.asmx` |

> Ojo operativo: `www.afip.gob.ar` rechaza TLS por defecto desde Node/curl modernos — hubo que
> forzar `--tlsv1.2` para bajar el PDF. Prever lo mismo al hablar con los endpoints.

**Método principal: `FECAESolicitar`.** Recibe cabecera (`PtoVta`, `CbteTipo`, `CantReg`) +
detalle, y responde `Resultado` (`A` aprobado / `R` rechazado / `P` parcial), **`CAE`** (14
dígitos) y **`CAEFchVto`**. Las validaciones se dividen en **excluyentes** (rechazan) y **no
excluyentes** (aprueban con observaciones — hay que loguearlas igual).

Métodos de apoyo relevantes: `FECompUltimoAutorizado` (último número autorizado — indispensable
para la correlatividad), `FEParamGetPtosVenta`, `FEParamGetTiposCbte`, `FEParamGetCondicionIvaReceptor`,
`FECompConsultar` (reconsultar un comprobante ya emitido — clave para la idempotencia), `FEDummy`
(health check), `FECompTotXRequest` (máximo de comprobantes por request).

## 3. HALLAZGO CRÍTICO: no se puede facturar sin conexión

El chofer vende en la calle, donde la señal es intermitente, y la app está construida para
funcionar offline. **El CAE exige conexión con ARCA en el momento de pedirlo.** No hay forma de
generar un CAE localmente.

El mecanismo que históricamente resolvía esto era el **CAEA** (autorización anticipada, se pide
por quincena y se usa offline). **Ya no sirve para esto:** la **RG 5782/2025** lo restringe
*exclusivamente a situaciones de contingencia* (código 15016 del manual), y exige que el domicilio
tenga al menos un punto de venta activo bajo CAE como modalidad principal. Usarlo como método
habitual de venta en la calle sería usarlo fuera de su marco normativo.

**La salida real está en la ventana de fechas.** Para `Concepto = 1` (Productos), el manual
permite que `CbteFch` sea **hasta 5 días anterior o posterior** a la fecha de generación, con el
límite de no exceder el mes de presentación. Es decir:

> El chofer vende sin señal → la app encola la factura con la fecha real de la venta → cuando hay
> señal (o al volver a planta) se pide el CAE conservando esa fecha → el comprobante queda
> legalmente fechado el día de la venta.

**Consecuencia de producto que hay que decidir:** el cliente **no recibe la factura en el momento
de la entrega**. Recibe el remito firmado (que la app ya emite) y la factura le llega después, por
mail o WhatsApp. Si el negocio exige entregar la factura impresa en mano, entonces el circuito
depende de tener señal en cada parada, y hay que preverlo.

**Límite duro:** los 5 días y el cierre de mes. Una venta del día 30 sin señal tiene hasta fin de
mes, no cinco días. El encolado necesita alarma por antigüedad.

## 4. Qué tipo de comprobante corresponde

Se decide por la condición frente al IVA del **receptor**, que desde la RG 5616 viaja obligatoria
en el campo **`CondicionIVAReceptorId`**.

Códigos del anexo del manual y clases de comprobante admitidas:

| Código | Condición | Clases admitidas |
|---|---|---|
| 1 | IVA Responsable Inscripto | A, B |
| 4 | IVA Sujeto Exento | A, B |
| 5 | **Consumidor Final** | A, B, C |
| 6 | Responsable Monotributo | A, B |
| 7 | Sujeto No Categorizado | A, B |
| 13 | Monotributista Social | A, B |
| 15 | IVA No Alcanzado | A, B |

**Dato que ya tenemos:** el sync de clientes desde Tango dejó `categoriaIvaTango` cargado en
`users/{uid}`. Distribución real de los 966 clientes (medida el 2026-09-01):

| Categoría Tango | Clientes | Condición ARCA |
|---|---|---|
| `RI` — Responsable inscripto | **786** | 1 |
| `RS` — Responsable monotributista | 17 | 6 |
| `EX` — Exento | 8 | 4 |
| `CF` — Consumidor final | 1 | 5 |
| `EXE` — IVA exento exportación | 1 | (caso aparte) |
| *sin categoría* | 153 (137 con CUIT) | **a resolver** |

O sea: **la enorme mayoría son Responsables Inscriptos → Factura A**, con CUIT del comprador
obligatorio e IVA discriminado. No es el caso simple de "ticket a consumidor final".

Los **153 clientes sin categoría** son un problema abierto: sin ese dato no se puede decidir el
tipo de comprobante. Se resuelve completando el sync (137 ya tienen CUIT) o bloqueando la venta
contado a esos clientes hasta tenerlo.

**Consumidor final sin identificar** (`DocTipo = 99`, `DocNro = 0`) solo se admite en comprobantes
B/C por debajo del monto de la RG 4444; por encima de ese monto hay que identificar al comprador
con documento real (validaciones 1417/1418/1419).

## 5. Credenciales y configuración

**Ya provisto por Ariel (2026-09-01):**

| Dato | Valor | Estado |
|---|---|---|
| Certificado de **producción** | `App Rolito_30ea2362f4992237.crt` — **CN=App Rolito**, CUIT 30697668973, RSA 4096, serie 30EA2362F4992237, vigencia 1/9/2026 → 31/8/2028 | ✅ verificado |
| Clave privada | `Privada_RedonhieloSA_AppRolito.key` — RSA 4096, sin passphrase | ✅ verificada: **el par coincide con el certificado** (módulo y exponente iguales, firma de prueba validada) |
| **Punto de venta** | **1104** | ✅ existe y está activo para web service |
| CUIT emisor | 30697668973 (Redonhielo S.A.) | ✅ coincide con el `serialNumber` del certificado |

### Verificado en vivo contra PRODUCCIÓN (2026-09-01)

`scripts/arca/verificar-conexion.mjs` — solo lectura, sin emitir ningún comprobante:

```
1. Infraestructura de ARCA (FEDummy)
   OK    app=OK db=OK auth=OK
2. Certificado habilitado para "wsfe" (WSAA)
   OK    Ticket de acceso obtenido, vence 2026-09-02T03:19:59Z
3. Punto de venta 1104 (FECompUltimoAutorizado)
   OK    Factura A: último autorizado = 0  →  el próximo sería el 1
   OK    Factura B: último autorizado = 0  →  el próximo sería el 1
```

**Toda la cadena funciona**: firma CMS con el certificado real → WSAA entrega el TA → WSFEv1
acepta las credenciales y responde. El certificado está correctamente asociado al servicio
"Facturación Electrónica" en el Administrador de Relaciones, y el punto de venta 1104 está
habilitado para web service y **virgen** (nunca emitió), así que la primera factura será la
número 1 de cada tipo.

### Tablas de referencia traídas de ARCA (producción, 2026-09-01)

**Tipos de tributo** — el que corresponde a la percepción del padrón de AGIP es el **7**:

| Id | Descripción |
|---|---|
| 1 | Impuestos nacionales |
| 2 | Impuestos provinciales |
| 3 | Tributos municipales |
| 4 | Impuestos Internos |
| 5 | IIBB |
| 6 | Percepción de IVA |
| **7** | **Percepción de IIBB** ← el nuestro |
| 8 | Percepciones por Tributos Municipales |
| 9 | Otras Percepciones |
| 13 | Percepción de IVA a no Categorizado |
| 99 | Otro |

**Alícuotas de IVA:** 3 = 0%, 4 = 10,5%, **5 = 21%**, 6 = 27%, 8 = 5%, 9 = 2,5%.

**Condición IVA del receptor:** 1 = RI, 4 = Exento, 5 = Consumidor Final, 6 = Monotributo,
7 = No Categorizado, 8 = Proveedor del Exterior, 9 = Cliente del Exterior, 10 = IVA Liberado
(Ley 19.640), 13 = Monotributista Social, 15 = No Alcanzado, 16 = Monotributo Trabajador
Independiente Promovido.

> Las tres tablas **coinciden exactamente** con las constantes que ya tenía el código
> (`ALICUOTA_IVA`, `CONDICION_IVA_POR_CODIGO_TANGO`), así que quedaron marcadas como verificadas
> en lugar de "estándar, confirmar".

**Puntos de venta habilitados:** hay **40** activos, todos en modalidad CAE y ninguno bloqueado
(101-103, 152, 201-208, 221-224, 241-244, 261-265, 281-282, 401-409, 665, 1001, 1102 y **1104**).
El resto es de Tango; **1104 es el de la app** y no debe usarse desde ningún otro sistema.

> **Certificado propio, no el de Tango.** Se emitió uno exclusivo para la app (alias
> "App Rolito") en vez de reutilizar el de Tango (`TangoCloud`, alias usado por la instalación
> que administra TC). Es lo correcto: cada certificado obtiene su **propio Ticket de Acceso**, con
> lo cual la app y Tango no compiten por el único TA válido que ARCA entrega por
> certificado+servicio. Ver el riesgo descrito más abajo, que con esto queda resuelto.

### Certificado de HOMOLOGACIÓN (2026-09-01)

| Dato | Valor |
|---|---|
| Archivo | `app_rolito_homo.crt` |
| Alias | `approlito` |
| Emisor | `CN=Computadores Test, O=AFIP` (CA de testing, distinta de la productiva) |
| **CUIT** | **20128494651** ← *no* es el de Redonhielo |
| Vigencia | 1/9/2026 → 31/8/2028, RSA 4096 |
| Clave privada | la **misma** `Privada_RedonhieloSA_AppRolito.key` (se usó el mismo CSR) — par verificado y firma de prueba OK |

> ⚠️ **El CUIT de homologación es distinto del de producción.** El certificado de testing salió a
> nombre de un CUIT de persona física (prefijo 20), no de Redonhielo S.A. (30697668973). Es lo
> habitual: el ambiente de homologación se asocia al CUIT de quien lo tramita con su Clave Fiscal.
>
> Consecuencia práctica: en homologación el `Auth.Cuit` **tiene que ser 20128494651**, porque debe
> coincidir con el del certificado; si se manda el de Redonhielo, ARCA responde error 601 ("CUIT
> representada no incluida en token"). Por eso el CUIT es parte de `config/arca` y no una
> constante: cambia junto con el ambiente.
>
> Consecuencia adicional: **los puntos de venta de homologación son otros**. El 1104 existe en
> producción; en testing hay que ver cuáles hay (los lista el paso 4 de
> `verificar-conexion.mjs`) o crearlos desde el ambiente de homologación de ARCA.

**Estado: homologación FUNCIONA (2026-09-01).** La primera prueba falló con
`Computador no autorizado a acceder al servicio` — el certificado existía y la firma era válida,
pero faltaba **asociarlo al servicio `wsfe`** desde el autogestión de ARCA (WSASS). Generar el
certificado y autorizarlo a un servicio son dos trámites distintos; en producción el segundo ya
estaba hecho. Una vez completado, el TA se obtiene sin problema.

`verificar-conexion.mjs` detecta ese error puntual y explica qué falta, en vez de devolver el
mensaje crudo de ARCA.

**Las tablas de referencia de homologación coinciden con las de producción** (mismos Id de
tributo, alícuotas de IVA y condiciones de IVA del receptor; solo cambia alguna palabra en las
descripciones). Eso permite probar en homologación con confianza de que el mapeo es el mismo.

**Falta un punto de venta en homologación.** `FEParamGetPtosVenta` devuelve
`[602] Sin Resultados`: el ambiente de prueba no trae ninguno dado de alta. Es lo esperado y no
impide emitir — hay que probar un número concreto (por ejemplo el 1) con
`FECompUltimoAutorizado`: si responde en vez de fallar, ese punto de venta sirve para las pruebas.
En `config/arca` el punto de venta va junto con el ambiente, así que homologación puede usar uno
distinto del 1104 productivo.

Las credenciales viven **solo en el escritorio de Ariel**. No se copiaron al repo. El `.gitignore`
bloquea `*.crt`, `*.key`, `*.pem`, `*.pfx`, `*.p12` y `*.csr`. Cuando se despliegue, van a
**secrets de Cloud Functions** (`firebase functions:secrets:set`), igual que `TANGO_BRIDGE_SECRET`.

**Probado localmente con las credenciales reales (sin llamar a ARCA):** el TRA se genera, se firma
en CMS/PKCS#7, y el mensaje resultante reparsea correctamente con el certificado adjunto y el TRA
adentro. El pipeline de firma funciona.

### RESUELTO — por qué NO se reutilizó el certificado de Tango

El primer certificado que se evaluó usar tenía alias **"TangoCloud"** y fecha de emisión 24/8/2026,
coincidente con la migración de Tango a la nube que hizo TC Servicios: era el que usa Tango para
facturar. Reutilizarlo traía un problema concreto que no es de numeración:

> El WSAA entrega **un solo Ticket de Acceso válido por vez** para cada combinación de
> certificado + servicio. Si se pide uno nuevo mientras hay otro vigente, ARCA responde
> *"El CEE ya posee un TA valido para el acceso al WSN solicitado"*. Con dos sistemas
> independientes usando el mismo certificado no hay forma de compartir ese ticket: cada uno
> tiene su propio cache y van a pisarse.

**Resuelto el 2026-09-01:** Ariel generó un certificado propio para la app (alias "App Rolito")
bajo el mismo CUIT. ARCA permite varios certificados por contribuyente y cada uno obtiene su TA
por separado, con lo cual el conflicto desaparece. **No reutilizar el de Tango.**

Independientemente de eso, **el punto de venta debe ser exclusivo de la app** (el 1104), nunca
compartido con el que usa Tango: ahí sí el problema sería de correlatividad.

### Sigue faltando

1. **Certificado de homologación** para poder probar el circuito completo sin efecto fiscal.
   El de producción emite comprobantes reales.
2. **Condición del emisor frente al IVA** (casi seguro Responsable Inscripto, confirmar) — define
   si emite A/B o C.
3. **Alícuota de IVA del hielo** — asumir 21% sin confirmarlo sería un error fiscal.
4. ~~El `tributoId` de ARCA para la percepción de IIBB.~~ **Resuelto: es el 7**
   (`TRIBUTO.PERCEPCION_IIBB`), verificado contra producción.

**Confirmado por Ariel (2026-09-01):**

- Todos los artículos llevan **IVA 21%**. No hay alícuotas mixtas, así que el default de
  `ALICUOTA_IVA.VEINTIUNO` es correcto para el catálogo actual (el código igual soporta alícuota
  por ítem, por si alguna vez cambia).
- **Los precios del catálogo son NETOS**, se les suma el IVA encima → **`preciosIncluyenIva: false`**.

## 6. Decisiones de producto pendientes

1. ¿El cliente recibe la factura en el momento (requiere señal) o después por mail/WhatsApp
   (permite offline)? Ver §3.
2. ¿Qué pasa si ARCA rechaza el CAE cuando el chofer ya entregó la mercadería y se fue? La venta
   física ya ocurrió; el comprobante queda pendiente y hay que resolverlo desde planta.
3. ¿Se numeran los puntos de venta por camión o uno solo compartido? Uno por camión evita
   contención en la correlatividad; uno solo simplifica la administración.
4. ¿Qué se hace con los 153 clientes sin categoría de IVA?

## 7. Riesgos a tener presentes

- **Idempotencia.** Si se pide un CAE y se corta la red antes de recibir la respuesta, el
  comprobante puede haber quedado autorizado igual. **Nunca reintentar a ciegas**: primero
  `FECompConsultar` sobre ese número, y recién emitir si no existe. Un duplicado es un problema
  fiscal, no un bug.
- **Correlatividad.** El número lo lleva el emisor, no ARCA. Dos ventas simultáneas del mismo
  punto de venta no pueden tomar el mismo número — hace falta serializar la asignación.
- **Responsabilidad fiscal.** Una vez emitido, el comprobante existe para ARCA. Un error de
  cálculo de IVA o un comprobante emitido de más se corrige con nota de crédito, no borrando.
- **Ambiente.** Todo el desarrollo va contra homologación. El salto a producción exige el
  certificado productivo y una revisión aparte.

## 7 bis. PRIMERA EMISIÓN REAL EN HOMOLOGACIÓN (2026-09-02)

El circuito completo se ejecutó de punta a punta por primera vez. **Tres comprobantes
emitidos y confirmados por ARCA**, punto de venta 1 de homologación:

| Comprobante | Caso | CAE | Total |
|---|---|---|---|
| `00001-00000002` | Factura A a RI, sin percepción | 86350838141968 | 30.317,76 |
| `00001-00000003` | Factura A **con percepción de IIBB** (tributo 7) | 86350838141971 | 30.818,88 |
| `00001-00000002` | Factura B a Consumidor Final | 86350838142090 | 6.063,55 |

Cada uno se volvió a consultar con `FECompConsultar` después de emitir: ARCA los
reconoce con el mismo CAE e importe. La percepción calculó 501,12 = 2% sobre el neto
de 25.056 (sobre el NETO, no sobre el total) y ARCA la aceptó.

**El punto de venta 1 sirve en homologación** aunque `FEParamGetPtosVenta` devuelva
"sin resultados": ese ambiente no trae puntos de venta dados de alta, pero el 1
responde a `FECompUltimoAutorizado` y emite sin problema.

`scripts/arca/emitir-prueba.mjs` es el que corre esto. Ejercita la **misma** cadena que
la Cloud Function (`emitirComprobante`), no una copia: validación del receptor, cálculo,
ventana de fechas, reserva de número y armado del `FECAEDetRequest` son los de
producción. Lo único que reemplaza es Firestore, por un contador en memoria — la prueba
no toca la base ni consume numeración real. Para correrlo contra producción exige
`ARCA_CONFIRMO_PRODUCCION=si` además del ambiente, porque ahí cada comprobante es real.

**Observación 10217 en las facturas A** (no es un error): *"El crédito fiscal
discriminado en el presente comprobante solo podrá ser computado a efectos del
Procedimiento permanente de transición al Régimen General"*. Es propia del CUIT de
homologación, que es un monotributista.

### Lo que enseñó la prueba

Un `tributoId` faltante en la percepción **no vuelve como "falta el Id"**: ARCA responde
un stack trace de .NET sobre un XML que no pudo deserializar
(`Read6_Tributo` → `Int16.Parse` → `FormatException`), imposible de diagnosticar desde
acá. Ahora `calcularImportes` valida el código de tributo antes de armar el XML y falla
con un mensaje que dice de dónde sale el valor. Cubierto por test.

## 8. Estado de la implementación (2026-09-01)

Construido y con tests (`npx vitest run functions/src/services/arca` → 50 tests). Todo del lado
de Cloud Functions a propósito: **la clave privada del certificado no debe bajar nunca al
dispositivo del chofer**.

| Archivo | Qué hace |
|---|---|
| `functions/src/services/arca/comprobante.ts` | Lógica fiscal pura: validación de CUIT con dígito verificador, mapeo condición IVA → tipo de comprobante, cálculo del desglose de IVA, ventana de emisión, armado del `FECAEDetRequest`. Sin red ni Firestore. |
| `functions/src/services/arca/wsaa.ts` | Autenticación: armado del TRA, firma CMS/PKCS#7 con `node-forge` (sin depender de un binario de openssl), llamada al WSAA y parseo del Token/Sign. |
| `functions/src/services/arca/wsfev1.ts` | Cliente SOAP: `FEDummy`, `FECompUltimoAutorizado`, `FECompConsultar`, `FECAESolicitar`. Distingue errores de observaciones. |
| `functions/src/services/arca/httpArca.ts` | Transporte HTTP. **No usa `fetch`** — ver abajo. |
| `functions/src/services/arca/ticketCache.ts` | Cache del Ticket de Acceso en Firestore. **Obligatorio, no es optimización**: ARCA entrega un solo TA válido por vez (12 h) y responde error si se pide otro mientras hay uno vigente. |
| `functions/src/services/arca/numeracion.ts` | Contador correlativo por punto de venta + tipo, en transacción de Firestore. Siembra desde `FECompUltimoAutorizado`, reutiliza huecos antes de avanzar, y permite verificar si divergimos de ARCA. |
| `functions/src/services/arca/emision.ts` | Emisión de un comprobante con el guard de idempotencia. Devuelve `emitido` / `rechazado` / **`incierto`**. |
| `functions/src/services/arca/configuracion.ts` | Lee y **valida** `config/arca`. Sin default para `preciosIncluyenIva` ni para el tributo; apagado salvo `habilitado: true` explícito. |
| `functions/src/services/arca/facturacionVenta.ts` | Ata todo a nivel de venta: garantiza que **una venta produzca a lo sumo una factura**. |

### Idempotencia a nivel de venta

Los triggers de Cloud Functions son *at-least-once*: el mismo evento puede llegar dos veces. Si
cada llegada reservara un número y llamara a ARCA, la segunda emitiría un duplicado.

El estado vive en **`facturasArca/{ventaId}`** — el ID es el de la venta, así que no puede haber
dos — y cada corrida decide según lo que encuentra:

| Estado encontrado | Qué hace |
|---|---|
| `emitida` | nada (ni siquiera reescribe) |
| con número, `incierta` o sin resolver | **pregunta a ARCA** por ese número; nunca re-emite |
| sin número | recién ahí emite |

Además, `emitirComprobante` acepta `onNumeroReservado`, que se llama con el número **antes** de
hablar con ARCA. El orquestador lo usa para dejar la primera escritura (`incierta` + número). Sin
eso, un corte entre la reserva y la respuesta dejaba un número en el aire que no se podía ni
consultar ni liberar. Si esa escritura falla, se aborta **sin llamar a ARCA** y se devuelve el
número: un comprobante que no podemos rastrear es peor que uno que no existe.

### El TLS de ARCA no funciona con `fetch` (encontrado en vivo, 2026-09-01)

Al correr el diagnóstico contra producción, la conexión se cae antes de llegar a HTTP:

```
write EPROTO ... SSL routines:tls_process_ske_dhe:dh key too small
```

Los servidores de ARCA negocian el handshake con un grupo **Diffie-Hellman de 1024 bits**, y
OpenSSL 3 —el que trae Node 22, o sea el runtime de Cloud Functions— lo rechaza de entrada: su
nivel de seguridad por defecto (SECLEVEL=2) exige 2048 bits o más.

Con el `fetch` global no hay forma limpia de ajustar eso, así que **todo el tráfico hacia ARCA va
por `httpArca.ts`**, que usa `node:https` y fija `minVersion: TLSv1.2` + `ciphers: DEFAULT@SECLEVEL=1`.

Esto **no deshabilita TLS**: la conexión sigue cifrada y con el certificado del servidor validado.
Lo único que se afloja es el tamaño mínimo aceptado en el intercambio de claves, y no por
preferencia nuestra sino porque es lo que soporta la infraestructura de ARCA.

> Detalle: `undici` **no** sirve como alternativa — en Node 22 viene embebido pero no es
> importable como paquete, y el primer intento del script falló por eso.

El script `scripts/arca/verificar-conexion.mjs` importa el mismo `httpArca.js` compilado, no una
copia: así el diagnóstico ejercita exactamente el transporte que usará producción.

### El estado "incierto" y por qué existe

El escenario a evitar: se pide el CAE, ARCA lo autoriza, se corta la red antes de que llegue la
respuesta, creemos que falló y reintentamos con el mismo número. Resultado: rechazo por no
correlativo, o un duplicado — que no se arregla borrando, se arregla con nota de crédito.

Por eso el resultado tiene **tres** estados, no dos:

| Situación | Estado | Qué pasa con el número |
|---|---|---|
| ARCA devuelve CAE | `emitido` | consumido, correcto |
| ARCA responde rechazando **y** se confirma que el comprobante no existe | `rechazado` | **liberado**, se reutiliza |
| ARCA responde rechazando pero no se puede confirmar | `rechazado` | **no** se libera (mejor un hueco que un duplicado) |
| Corte de red / timeout | **`incierto`** | **no** se libera; lo resuelve `resolverIncierto()` |

Reglas que sostienen esto y conviene no aflojar:

- **Nunca reintentar a ciegas.** Ante un `incierto` solo se puede preguntar (`FECompConsultar`).
- Incluso ante un rechazo explícito de ARCA se **verifica antes de liberar** el número: si por un
  error de parseo el comprobante sí existía, liberarlo generaría un duplicado más adelante.
- El número se reserva **antes** de llamar a ARCA. Reservarlo después dejaría una ventana en la
  que dos ventas simultáneas mandan el mismo número.
- Las validaciones baratas (cliente facturable, ventana de 5 días) corren **antes** de reservar,
  para no quemar numeración al pedo.

**Decisiones tomadas al construir, que conviene no revertir sin pensarlo:**

- **`preciosIncluyenIva` no tiene valor por defecto.** Es un parámetro obligatorio de
  `calcularImportes`. Equivocarse cambia el total facturado en un 21%, así que se prefiere que el
  código no compile a que adivine. **Sigue pendiente confirmarlo con el negocio.**
- **Redondeo half-even**, que es el criterio que declara ARCA en el manual. Con half-up los
  totales pueden diferir en un centavo y hacer fallar la validación de que
  `ImpTotal = neto + IVA + exento + tributos`.
- **Un comprobante por request**, aunque `FECAESolicitar` acepte lotes: cada venta se resuelve
  sola y un rechazo no arrastra a las demás.
- **El error 602 de `FECompConsultar` se trata como "no existe"**, no como falla — es la respuesta
  normal al preguntar por un comprobante que no se emitió, y es la base de la idempotencia.
- `functions/tsconfig.json` ahora excluye `**/*.test.ts`: sin eso `tsc` emitía los tests a `lib/`
  (que va commiteado y se despliega) arrastrando imports de vitest.
- **Todas las fechas fiscales se comparan por día calendario ARGENTINO**, vía `diaCalendarioAr()`.
  Comparar con `getTime()` o `getMonth()` usa la zona de la máquina — que en Cloud Functions es
  UTC — y hace que una venta de las 23:00 caiga en el día siguiente: el 30 de septiembre a las 23
  pasaba a ser 1 de octubre y rompía tanto la vigencia del padrón como el chequeo de cierre de
  mes. Los tests corren también con `TZ=UTC` para que esto no vuelva a colarse.

**Falta para poder emitir:**

1. La **clave privada** del certificado (ver §5) → va a secrets de Cloud Functions.
2. Un **certificado de homologación** para probar sin efecto fiscal.
3. El **punto de venta** propio.
4. Confirmar `preciosIncluyenIva` y la alícuota.
5. ~~La asignación serializada del número y el guard de idempotencia.~~ **Hecho** (`numeracion.ts`,
   `emision.ts`).
6. ~~La Cloud Function y el job de reconciliación.~~ **Hechos**
   (`functions/src/triggers/arcaFacturacion.ts`), ver abajo.
   - ~~Reglas de Firestore.~~ **Hechas**, con 11 tests nuevos (372 en total, todos en verde).
7. El bloqueo en la pantalla del chofer para no dejar cerrar una venta contado a un cliente no
   facturable (`validarReceptor` ya existe para eso; falta exponerlo en la UI).
8. Guardar el CAE y su vencimiento en `ventasCamion`, y generar el PDF del comprobante con el
   código de barras / QR para entregárselo al cliente.

## 9. Percepción de IIBB de CABA — pendiente de diseño

Dato aportado por Ariel (2026-09-01): **Redonhielo es agente de percepción de Ingresos Brutos de
CABA**, y mes a mes importa en Tango el **padrón de alícuotas** de AGIP para actualizar la
alícuota que le corresponde a cada cliente.

Esto cambia la forma del comprobante: deja de ser "neto + IVA" y pasa a llevar un tributo aparte.
En WSFEv1 se informa en el array `<Tributos>`, con `Id`, `Desc`, `BaseImp`, `Alic` e `Importe`,
y `ImpTrib` debe ser **exactamente la suma** de los importes (validación 10029, con una tolerancia
del 0,01%).

**Implementado (2026-09-01).** `calcularImportes` acepta `percepcionIIBB` y emite el tributo con
base en el **neto**; `ImpTrib` se deriva de la suma, nunca se recibe. Si el cliente no está en el
padrón simplemente no se pasa la percepción y el comprobante sale sin tributos.

`construirDetalle` **se niega a facturar si el padrón está vencido** (`percepcionVigente`): la
alícuota lleva su período de vigencia y se compara contra la fecha de la venta. Es el mismo
criterio que con los clientes mal configurados — frenar antes que emitir mal.

El `tributoId` es un parámetro obligatorio, sin default: sale de `FEParamGetTiposTributos` y
**no se hardcodea**.

**Lo que NO hay que adivinar y por eso se consulta:**

- El `Id` de tributo correcto para una percepción de IIBB. El manual no fija la lista — la
  devuelve `FEParamGetTiposTributos`. Por eso `verificar-conexion.mjs` ahora la imprime (paso 4),
  junto con alícuotas de IVA, condiciones de IVA del receptor y puntos de venta habilitados.
- Si la alícuota del padrón viaja en el ABM de clientes de Tango. El export anterior recortaba
  campos, así que `export-tablas-tango.ps1` ahora baja además **5 clientes con todos sus campos**
  (`clientes-muestra.json`) para verlo. Indicio a favor: el JSON de la API de Pedidos modela
  `LIQUIDA_PERCEPCION_INGRESOS_BRUTOS`, `ID_GVA41_ALICUOTA_FIJA_PERCEPCION_IIBB` y
  `CONSIDERA_IVA_BASE_CALCULO_IIBB`, con las alícuotas en la tabla **GVA41** (códigos 51 a 80) y
  la clasificación impositiva del cliente en **GVA150**.

**Reglas confirmadas por Ariel (2026-09-01):**

| Pregunta | Respuesta |
|---|---|
| ¿A quién se percibe? | Solo a los clientes **que figuran en el padrón**, cada uno con **su propia alícuota**. La alícuota se toma del **ABM de clientes de Tango** (que ya importa el padrón cada mes). |
| Base de cálculo | El **neto** (sin IVA). Está configurado así en Tango. |
| Monto mínimo | Para CABA **no hay**. |
| ¿De qué depende? | De la **jurisdicción de la venta**. |
| ¿Depende de la condición de venta? | **No.** Se percibe si el cliente tiene la percepción declarada en el padrón, sea contado o cuenta corriente. |

### El padrón de AGIP: formato y magnitud real

Ariel aportó el padrón `ARDJU008082026.rar` (20 MB comprimido, **134 MB** de texto,
**1.608.472 registros**). Formato: texto plano `latin1`, delimitado por `;`, sin encabezado.

| # | Campo | Ejemplo |
|---|---|---|
| 1 | fecha de publicación | `28072026` |
| 2 | vigencia desde | `01082026` |
| 3 | vigencia hasta | `31082026` |
| 4 | CUIT | `20001019180` |
| 5 | tipo de contribuyente | `D` (directo/local) o `C` (convenio multilateral) |
| 6-7 | marcas | `S` / `N` |
| 8 | **alícuota de PERCEPCIÓN** | `4,00` (coma decimal) |
| 9 | alícuota de retención | `4,00` |
| 10-11 | grupos | `00` |
| 12 | razón social | `FUEZ BERNARDO M` |

> **Cuidado con los campos 8 y 9.** En la mayoría de los registros coinciden, pero **no siempre**:
> en el cruce contra nuestra base, **156 clientes tienen percepción distinta de retención** (por
> ejemplo, uno con percepción 0,5% y retención 2%). Confundirlos factura mal a esos 156. La
> asignación de arriba sigue el layout publicado por AGIP y **conviene confirmarla** comparando,
> para un mismo CUIT, la alícuota que devuelve el ABM de Tango contra la del padrón.

**Cruce contra nuestros clientes** (`scripts/arca/cruce-padron-iibb.mjs`, padrón 08/2026):

- 945 clientes de la app tienen CUIT.
- **395 figuran en el padrón**, y **347 de ellos tienen alícuota de percepción > 0**.
- Las alícuotas van de **0,01% a 6%**, con 16 valores distintos. La más frecuente es **3%**
  (120 clientes), seguida de 6% (35) y 0,5% (40).
- Tipo de contribuyente: 331 directos, 64 de convenio multilateral.

O sea: **no es un caso de borde**. Aproximadamente el 43% de los clientes facturables lleva
percepción, y la alícuota varía cliente por cliente.

### La vigencia es mensual — y esto ya mordió

El padrón aportado tiene vigencia **01/08/2026 → 31/08/2026**: **venció el 31 de agosto**, o sea
ayer respecto de esta sesión. Facturar hoy con esas alícuotas sería incorrecto.

Por eso el script marca el vencimiento explícitamente, y por eso la alícuota que guarde la app
debe llevar **fecha de vigencia**, con el sistema negándose a facturar (o avisando fuerte) si el
padrón del mes en curso no se cargó. El riesgo no es que falle: es que **emita mal en silencio**.
Se agrava porque el sync diario de clientes desde Tango **está caído desde el 27/8**.

**Riesgo a tener presente:** el padrón se actualiza **todos los meses**. Si la app calcula la
percepción con una alícuota vieja, emite comprobantes mal — en silencio, sin ningún error. Sea
cual sea el origen del dato, hace falta que la alícuota tenga **fecha de vigencia** y que el
sistema se niegue a facturar (o avise) si el padrón del mes en curso no se cargó. Esto es más
delicado todavía porque el sync diario de clientes desde Tango **está caído desde el 27/8** (ver
`docs/tango/INTEGRACION.md`): un dato que se actualiza solo, pero cuyo actualizador no está
corriendo, es exactamente la forma en que esto sale mal.

### RESUELTO (2026-09-02): el dato entra por el padrón, no por Tango

**Decisión de Ariel:** la alícuota se importa **directamente del padrón de AGIP**, no del sync de
clientes de Tango. Motivos: es la fuente original, trae la vigencia adentro del propio archivo, y
no depende del sync que está caído. Tango sigue importando el padrón por su lado para lo suyo.

`scripts/arca/importar-padron-iibb.mjs` completa `users/{uid}.percepcionIIBB` con
`{ alicuota, vigenciaDesde, vigenciaHasta, origen, padron }`. Sin `--escribir` es un simulacro.
Verificado contra producción el 2026-09-02: **945 clientes con CUIT y 0 con percepción cargada** —
o sea que hasta ahora la app habría facturado sin percibirle a nadie.

Dos decisiones del importador:

- **Se planta si el padrón que le pasan ya venció**, en vez de importarlo igual. Cargarlo dejaría
  a todos los clientes con una vigencia expirada y la app se negaría a facturarles.
- **A los que dejaron de figurar en el padrón les BORRA el campo.** Quedarse con la alícuota del
  mes pasado es justamente el error a evitar.

**Y el aviso, para que no se olvide:** `avisarPadronIIBB` (`functions/src/triggers/padronIIBB.ts`)
corre todos los días a las 9 y manda mail a `configuracion/notificaciones.emails` cuando faltan
≤ 7 días, cuando ya venció, o cuando nunca se importó ninguno. *Por vencer* avisa una sola vez por
padrón (para no volverse ruido); *vencido* avisa todos los días, porque mientras siga así no se le
puede facturar a nadie con percepción. El importador deja el estado en `config/arcaPadronIIBB`,
que es lo que lee el aviso — sin eso el vencimiento se descubría recién cuando rebotaba la primera
factura. Ese documento entra en la excepción de escritura de `config` (`esConfigArca` pasó a
matchear `arca.*`): ni un operador puede estirar la vigencia a mano.

## 9 bis. Triggers, reconciliación y seguridad

### `functions/src/triggers/arcaFacturacion.ts`

- **`onVentaContadoFacturar`** — alta de una `ventasCamion` con `canal: 'contado'` → factura.
  Las ventas `promo` (Rolito) se ignoran. Los errores **no se relanzan**: relanzar haría que Cloud
  Functions reintentara el trigger, y un cliente sin CUIT no se arregla reintentando. El error
  queda registrado como `estado: 'pendiente'` y lo levanta la reconciliación.
- **`reconciliarFacturasArca`** — cada hora. Distingue dos casos que **no** se tratan igual:
  `incierta` (se pidió el CAE y no sabemos si salió → solo se puede *preguntar*) y `pendiente`
  (nunca se llegó a intentar → se reintenta de cero). Un fallo individual no frena la tanda.
  Corre seguido a propósito: una factura sin resolver consume la ventana de 5 días, y pasada esa
  ventana la venta ya no se puede facturar con su fecha real.

**De dónde sale la percepción del cliente:** `users/{uid}.percepcionIIBB = { alicuota,
vigenciaDesde, vigenciaHasta }`. Sin ese campo se entiende que el cliente **no está en el padrón**
y no corresponde percibirle. Si tiene alícuota **pero no vigencia, se rechaza la factura**: sin
período no hay forma de saber si el padrón está al día. **Queda pendiente que el sync desde Tango
complete ese campo** — es el último hueco funcional.

### Reglas de Firestore (`firestore.rules`)

| Colección | Lectura | Escritura |
|---|---|---|
| `arcaTickets/*` | **nadie** | **nadie** |
| `facturasArca/*` | staff | **nadie** |
| `config/arca` | staff | **nadie** |
| `config/arcaNumeracion_*` | staff | **nadie** |

Todo lo que dice "nadie" queda solo para el Admin SDK (y la consola de Firebase, que lo usa).

El ticket de acceso no se expone **ni a super_admin**: es una credencial que permite emitir
comprobantes en nombre de la empresa, y no hay ningún motivo para verla desde la app.

> **Detalle de Firestore que casi se pasa por alto:** las reglas son permisivas *por unión* — una
> regla más específica **no puede restringir** lo que otra concede. La regla genérica
> `match /config/{docId}` daba `allow write` a cualquier operador, así que la excepción de los
> documentos de ARCA tuvo que ir **dentro de esa misma regla** (`&& !esConfigArca()`), no en un
> `match` aparte. Un `match /config/arcaNumeracion_{x}` con `allow write: if false` no habría
> restringido nada.

### Todavía sin exportar en `index.ts`, a propósito

Las funciones declaran los secrets `ARCA_CERT_PEM` y `ARCA_KEY_PEM`, y
`firebase deploy --only functions` **falla entero** si un secret declarado no existe — bloquearía
también el deploy de funciones que no tienen nada que ver. Los pasos para habilitarlas están
comentados en `functions/src/index.ts`.

## 10. El comprobante impreso

Relevado de una **factura A real emitida desde Tango** (`Factura final tango.pdf`, comprobante
00101-00282333 del 26/08/2026) que aportó Ariel el 2026-09-01. El PDF de la app debe replicar
este formato: el cliente ya lo conoce, y así no hay dos comprobantes distintos conviviendo.

### Datos del emisor (fijos, van en todas las facturas)

| Dato | Valor |
|---|---|
| Razón social | Redonhielo S.A. |
| CUIT | 30-69766897-3 |
| Domicilio | Av. Panamericana KM 25.700 |
| Ingresos brutos | 9024264411 |
| **Condición frente al IVA** | **Responsable inscripto** ← confirma el supuesto de §4 |
| Inicio de actividades | 01/07/1998 |
| Teléfono / e-mail | (011) 4741-8000 / ventas@redonhielo.com.ar |
| CBU | 0720072420000001271304 |

### Estructura del comprobante

- **Encabezado:** letra y tipo (`FACTURA A`), `Punto de venta - Nro. comp.` con formato
  **`00101-00282333`** (5 dígitos de punto de venta + 8 de número; el de la app sería
  `01104-00000001`), fecha de emisión.
- **Información del cliente:** razón social, CUIT, condición frente al IVA, condición de venta,
  domicilio, vendedor.
- **Detalle:** descripción, cantidad con unidad, precio unitario, total por renglón. Debajo, la
  orden de compra del cliente si la hay (`OC 65588`).
- **Vencimiento:** importe y fecha (viene de la condición de venta, ej. "7 DIAS F.F.").
- **Resumen:** Subtotal → Bonificaciones → IVA → leyenda *"Régimen de Transparencia Fiscal al
  Consumidor (Ley 27.743)"* → **`Perc.IIBB CABA`** → Total.
- **Pie:** CAE, fecha de vencimiento del CAE, y las leyendas de mora y domicilio de pago.

> **La percepción de IIBB ya tiene su renglón propio** (`Perc.IIBB CABA`), incluso cuando es $0.
> Confirma que va como línea separada del subtotal y el IVA, tal como se implementó en
> `calcularImportes`.

### Verificación aritmética contra nuestro cálculo

El ejemplo confirma que **los precios son netos**:

```
100 unidades × $1.680,00        = $168.000,00   (Subtotal)
$168.000,00 × 21%               =  $35.280,00   (IVA)
$168.000,00 + $35.280,00        = $203.280,00   (Total)
```

Es exactamente lo que produce `calcularImportes` con `preciosIncluyenIva: false` y alícuota 21%.

### Falta agregar: el QR

El texto extraído del PDF no muestra el **código QR** de la RG 4892, que es **obligatorio** en
todo comprobante electrónico (puede estar como imagen y no haberse extraído). El PDF de la app lo
lleva sí o sí. Herramientas: el repo ya tiene `qrcode` y `jspdf` + `jspdf-autotable`, y
`src/utils/pdf.ts` tiene once generadores con el estilo de la casa para tomar como base.

Ariel también pidió que los remitos de la app **se importen en Tango como remitos**. Está
confirmado (ver `docs/tango/INTEGRACION.md`) que **ninguna API de Axoft crea remitos** — ni
Transacciones Ventas, ni el Facturador, ni eCommerce. Las vías posibles son:

1. Que Tango genere el remito solo, desde el circuito de facturación.
2. Importación por archivo ("apertura" por Excel), si Tango la soporta para remitos — el manual de
   la API de Pedidos menciona que los pedidos se pueden importar por API **o Excel**, así que vale
   preguntar si remitos tiene un importador equivalente.
3. Escritura SQL directa, como hacía Bluesoft.

Definir cuál antes de construir nada de esta parte.

## 11. El circuito de documentos, según canal y forma de pago (2026-09-02)

Explicado por Ariel. **Es la regla de negocio que manda sobre todo lo anterior**, y no coincide
del todo con lo que estaba construido — ver el hueco al final.

| Canal | Forma de pago | Empresa en Tango | ARCA | Documento que se emite | Quién lo emite |
|---|---|---|---|---|---|
| **Contado** | Efectivo | REDONHIELO (`Company: 1`) | **Sí** | Factura electrónica | **La app**, en el momento |
| **Contado** | Transferencia | REDONHIELO | **Sí** | Factura electrónica | **La app**, en el momento |
| **Contado** | Cuenta corriente | REDONHIELO | — | **Remito oficial** | La app lo emite; **Tango lo factura después**, desde la oficina |
| **Promo** | Cualquiera | **ROLITO** (`Company: 3`) | **No** | Factura y remito **no oficiales** | La app |

La segunda columna se lee así: el canal decide **la empresa** (son dos bases distintas en Tango,
con la misma cartera de clientes y el mismo `codigoTango`), y la **forma de pago** decide el
documento dentro del canal contado:

- **Efectivo** y **transferencia** → factura electrónica por ARCA, emitida por la app.
- **Cuenta corriente** → **no factura la app**. Emite un remito oficial que viaja a Tango, y el
  personal de la oficina lo factura desde ahí. Facturarlo también en la app sería duplicarlo.

**Promo (Rolito) es no oficial pero NO es solo papel:** la factura y el remito **también viajan a
Tango**, a la empresa Rolito. Lo que no lleva es autorización de ARCA. Lo que sí es
imprescindible en promo: **la firma del cliente, tanto en la factura como en el remito**.

> Sobre el "CAE ficticio" de promo, conviene separar dos cosas: **guardar un número propio en el
> campo correspondiente de Tango** no tiene ningún problema y es lo que hace falta para que el
> comprobante entre al sistema. **Imprimir un papel que imite un comprobante fiscal** (formato de
> factura A, código de barras y un CAE inventado) sí es riesgoso: puede leerse como comprobante
> apócrifo. El papel de promo debería llevar numeración propia, el mismo diseño y la firma, pero
> **sin QR de AFIP ni código de barras**, y con una leyenda que lo distinga.

### Los cambios son artículos

Un cambio es la bolsa rota del cliente por una nueva, sin cargo. Cada producto tiene su artículo de
cambio asociado (*Cambio Hielo bolsa 2kg*), y los cambios se registran como **renglones del
documento que salga de la operación**: la factura si se cobró en efectivo o transferencia, el
remito si va a cuenta corriente. Igual para las dos empresas.

Implementación (`src/utils/cambios.ts`, con tests):

- **Derivados del catálogo**, no cargados a mano: `articulosDeCambio(catalogo)` produce un artículo
  por producto, con id `cambio_{productoId}` y nombre `Cambio {nombre}`, conservando la foto para
  que la botonera se vea igual. Un producto nuevo trae su cambio sin que nadie se acuerde de
  crearlo.
- **Siempre en $0.** Viven en `ventasCamion.cambios`, un array aparte de `items`, justamente para
  que no haya forma de que se cuelen en el total ni en lo que se declara a ARCA. (WSFEv1 no lleva
  renglones —solo importes—, así que un cambio es invisible para ARCA por construcción.)
- **La liquidación los normaliza al producto**: `cambio_bolsa_2kg` cae en la fila de `bolsa_2kg`,
  porque la carga y la descarga cuentan bolsas de hielo, no cambios.
- **Una operación de solo cambios vale $0 y sale por remito**, nunca por factura: ARCA rechaza un
  comprobante en cero, y no hay nada que facturar.

Hasta el 2026-09-02 el cambio era una operación aparte, con su propia pantalla y su colección
`cambiosCamion`. Esa colección quedó **cerrada a escritura** (`allow write: if false`) y se sigue
leyendo solo para que los días anteriores liquiden igual.

### Quién decide: `services/arca/circuito.ts`

La regla de la tabla vive en un solo lugar, `documentoDeVenta(canal, formaPago, total)`, con sus
tests:

```ts
documentoDeVenta('contado', 'contado_efectivo', 20000)  // 'factura_arca'
documentoDeVenta('contado', 'cuenta_corriente', 20000)  // 'remito'
documentoDeVenta('contado', 'contado_efectivo', 0)      // 'remito' — solo cambios
documentoDeVenta('promo',   cualquiera,         20000)  // 'no_oficial'
documentoDeVenta('contado', 'cheque',           20000)  // null → no se emite nada
```

`onVentaContadoFacturar` la consulta dos veces: al entrar el evento (filtro barato, antes de tocar
secrets y red) y en `facturar()` sobre la venta releída, que es la palabra final. Solo
`'factura_arca'` llega a ARCA.

El `null` es deliberado: si una venta no dice cómo se cobró, no se factura y queda el `console.warn`.
Emitir a ciegas es lo único que no se puede deshacer.

La reconciliación cierra con estado **`no_corresponde`** todo registro `pendiente` cuyo `facturar()`
devuelve `null` (promo, cuenta corriente, o venta borrada). Sin ese cierre el registro se
reintentaría cada hora para siempre sin que nada cambie nunca.

El front tiene su espejo en `src/utils/circuitoDocumento.ts` (mismo criterio que
`utils/facturable.ts` con `validarReceptor`): sirve para decirle al chofer, en el resumen, qué
papel le va a quedar al cliente. **El que manda es el del servidor.**

En la pantalla del chofer, el bloqueo por cliente no facturable se aplica **solo cuando la app va a
emitir**: en cuenta corriente la entrega sale igual con un aviso ámbar para la oficina, porque
faltarle un dato fiscal al cliente es un problema de ellos, no motivo para frenar a un chofer en la
calle.

### Lo que bloquea el resto del circuito

Tres de las cuatro filas de la tabla necesitan que la app **cree comprobantes en Tango**, y hoy no
hay vía:

- La licencia tiene **"Transacciones Tango Ventas: No"** (verificado 25/8 y 31/8): la API no crea
  facturas ni pedidos.
- **Ninguna API de Axoft crea remitos**, ni siquiera contratando ese módulo — ver
  `docs/tango/INTEGRACION.md`.

Lo único que la app resuelve hoy de punta a punta es la factura por ARCA de contado
efectivo/transferencia.

**El remito impreso tampoco existe todavía.** Los cambios de una venta de cuenta corriente ya se
capturan y quedan guardados en la venta, listos para imprimirse; lo que falta es el documento en
sí, que necesita decisiones propias: numeración (serie aparte de la de ARCA), diseño, y si lleva
la firma como constancia. Es la pieza siguiente, y no depende de Tango: el remito se puede imprimir
y firmar aunque todavía no haya forma de meterlo en el sistema.

**Y falta crear los artículos de cambio en Tango.** La app los deriva sola de su catálogo, pero
cuando el comprobante viaje a Tango cada cambio va a necesitar su código de artículo del otro lado.

## 12. El mostrador (ventanilla) factura igual que el camión (2026-09-03)

Decidido con Ariel el 2026-09-03: la tabla del §11 aplica también a la venta por ventanilla.
Hasta ese día `ventasVentanilla` no tenía trigger de ARCA ni de Tango: una venta de contado en el
mostrador salía sin comprobante fiscal desde la app.

- **`onVentaVentanillaContadoFacturar`** (`triggers/arcaFacturacion.ts`): mismo `facturar()` que
  el camión, parametrizado por colección. El registro `facturasArca/{ventaId}` guarda `coleccion`
  para que la reconciliación y el aviso por mail lean la venta del lugar correcto (los registros
  viejos no tienen el campo y son del camión).
- **`onVentaVentanillaCreada` / `onVentaVentanillaFacturada`** (`triggers/tangoOutbox.ts`): espejo
  de los del camión; el item del outbox lleva `origenColeccion: 'ventasVentanilla'` y el write-back
  acepta las dos colecciones.

### El cliente ocasional es consumidor final

No existe en Tango, así que no hay `categoriaIvaTango` de dónde sacarlo: el trigger arma el
receptor como `CF` con `mostrador: true`. `validarReceptor` decide la identificación:

| Caja cargó | DocTipo | Condición |
|---|---|---|
| CUIT válido | 80 | — |
| DNI (7 u 8 dígitos) | 96 | — |
| Nada | 99 (sin identificar), DocNro 0 | solo si el total ≤ `config/arca.topeConsumidorFinalSinIdentificar` |

El tope lo fija ARCA (RG 5003 y actualizaciones) y cambia cada tanto: por eso vive en
`config/arca` y no en el código. **Ausente o 0 = siempre hay que identificar** — es el estado al
salir este cambio; hay que cargar el valor vigente antes de vender a ocasionales sin documento.
`construirDetalle` es quien aplica el tope porque es quien conoce el total con IVA.

Un cliente **registrado** nunca pasa por acá: se le sigue exigiendo CUIT aunque sea consumidor
final, porque su dato viene de Tango y si falta, falta en Tango.

### Qué imprime caja

Decisión: **nada hasta tener el CAE.** `VentanillaPage` crea la venta y abre un modal que se
suscribe al doc hasta que el trigger escribe `factura`:

- `emitida` → imprime la factura (`facturaArcaPdf`, importes tal como se declararon) y el
  comprobante de turno, una sola vez.
- `rechazada` / `incierta` → lo dice, deja imprimir solo el turno (la venta ya se cobró; muelle
  entrega contra el turno) y la oficina recibe el aviso por mail de la reconciliación.
- Si ARCA tarda más de 45 s, ofrece imprimir el turno y seguir; la factura queda en el listado
  del día con su botón cuando aparezca.

Antes de cobrar, la pantalla avisa si la venta no va a poder facturarse (cliente registrado sin
CUIT o sin condición de IVA; ocasional sin documento por encima del tope) — la autoridad sigue
siendo el servidor.
