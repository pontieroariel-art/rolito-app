# Stock del reparto en Tango: diseño propuesto (2026-09-04)

Estado: **circuito APROBADO por Ariel el 2026-09-04** (con el ajuste de §3b). Quedan las decisiones de §4. Contexto en `INTEGRACION.md` §20–§22 y muestras
reales en `sql/muestras-stock-2026-09-04.json`.

## 1. De dónde partimos

Hasta el 2026-08-19 Bluesoft escribía directo en la base de Tango todos los comprobantes del
reparto. Desde el 2026-08-20 Bluesoft no existe y **ningún movimiento de stock del reparto llega a
Tango**: ni cargas, ni descargas, ni cambios, ni mermas. Solo entran las facturas (ARCA + Tango
Connect, desde el 2026-09-02) y la producción, que el supervisor carga a mano.

Lo que hacía Bluesoft, y sus tres defectos:

| Comprobante | Qué hacía | Problema |
|---|---|---|
| CAR | planta → camión (transferencia) | correcto |
| REM / FAC / BOL | venta: egreso del camión | correcto |
| CBS | por cliente con cambios: **entra** el artículo ficticio `CAMBIOxxx` al depósito 99 Mermas | no saca la bolsa buena del camión; el artículo ficticio acumula stock (99 tiene 88.503 "CAMBIOHIELO3KG") y los camiones quedan en negativo cuando alguien lo pone en una venta |
| DES | camión → planta con lo que volvió | correcto |
| MER | planta → 99 con las bolsas rotas reales | la merma queda registrada dos veces (CBS con ficticio, MER con real) |

Consecuencia: el stock de cada camión en Tango nunca cerraba en cero por sí solo, y los informes
de merma no cuadran.

## 2. Principios para hacerlo bien

1. **Un evento físico, un comprobante.** La app registra cada hecho una sola vez (carga, venta,
   cambio, descarga, liquidación, producción) y Tango recibe un espejo fiel, idempotente, con la
   referencia de la app en la cabecera (`ROLITO:<coleccion>:<id>`). Nada se tipea dos veces.
2. **Solo artículos reales mueven stock.** Los artículos `CAMBIO*` no vuelven a tocar STA19.
3. **Cada camión cierra el día en cero.** Conservación: `cargado = vendido + cambios + sano
   devuelto + rotas + faltantes`. Si no da cero, es un error visible, no un stock fantasma.
4. **La merma vive en un solo lugar (99) y con el artículo real.**
5. **Trazabilidad por cliente de los cambios**, que es lo valioso del CBS viejo, se conserva.
6. **Transacción por comprobante, reintentos, y conciliación diaria** app ↔ Tango.

## 3. El circuito propuesto, comprobante por comprobante

| Paso | Evento en la app | Comprobante en Tango | Movimiento |
|---|---|---|---|
| Producción | `produccionPallets` por turno | PDT / PRO (ingreso) | → planta 01 / 02 |
| Carga | `remitosCarga` confirmado en muelle | **CAR** (TI) | planta → camión, bolsas + pallets + racks |
| Venta contado | `ventasCamion` contado | FAC (ARCA + Tango Connect, ya funciona) | camión → cliente |
| Venta cta. cte. | `ventasCamion` cuenta corriente | **REM** (SQL, hecho §21) | camión → cliente |
| Cambio | `ventasCamion.cambios` | **CBS nuevo** = transferencia (TI) con el **artículo real**, cliente y chofer en cabecera | camión → 99 |
| Descarga | `descargasCamion` (sano contado) | **DES** (TI) | camión → planta |
| Rotas en exceso | `descargasCamion.bolsasRotas` − cambios del día, si es > 0 | **MER** (TI) | camión → 99 |
| Faltantes | `liquidaciones` (diferencia final) | **AJU** (TI) | camión → **98 Diferencias de reparto** (depósito nuevo) |
| Mostrador | `ventasVentanilla` | FAC / REM desde el depósito de la **planta** (`config/tango.depositosPlanta`: torcuato 01, merlo 02); no hay depósito en tránsito | planta → cliente; cambio: planta → 99 |

Por qué el cambio como transferencia camión → 99 con el artículo real: es exactamente lo que
Ariel describe que pasa ("descuenta del camión y manda a merma"), usa un tipo nativo de Tango,
saca la bolsa buena del camión en el momento, y deja en 99 la bolsa rota que va a volver. Al
descargar, las rotas contadas se comparan con los cambios del día: solo el exceso se mueve.

Los artículos `CAMBIO*` quedan **solo como renglón informativo a $0 en la factura**, y únicamente
si se los configura en Tango para no mover stock. Si no se puede, se dejan de incluir: el CBS
nuevo ya documenta el cambio por cliente.

## 3b. Cómo se documenta el cambio ante el cliente (definido con Ariel, 2026-09-04)

Ejemplo: camión con 100; el cliente compra 48 y recibe 2 de cambio; suben 2 rotas.

- **Cuenta corriente:** UN remito (papel de la app + REM en Tango) con los renglones reales
  (48 × `PTHIBOLROLI0010`, sin precio: Tango lo valoriza al facturar) más los renglones
  **CAMBIO** (2 × `CAMBIOHIELO10KG`). Al facturar los remitos pendientes, la mercadería sale
  con precio de lista y el cambio a $0 (el artículo CAMBIO tiene precio 0 en todas las listas).
- **Contado:** factura ARCA solo con lo vendido (sin renglón a $0). Si hubo cambio, además un
  **remito de cambio** de la app, firmado, con los renglones CAMBIO. En Tango NO entra como REM
  (esta versión de Tango no tiene "cierre de remitos": quedaría pendiente de facturar); entra
  solo la transferencia de stock, que lleva cliente, chofer y el número del remito de cambio en
  la cabecera. Verificado con Ariel el 2026-09-04.
- **Stock, en los dos casos:** el REM/FAC saca del camión las 48 reales; el renglón CAMBIO no
  mueve stock (el artículo se configura "no lleva stock"); una **transferencia camión → 99 con
  el artículo real × 2** saca las 2 buenas entregadas y deja en 99 las 2 rotas. Camión: 100 −
  48 − 2 = 50, que es lo físico. Al descargar, las rotas contadas se comparan con los cambios
  del día: solo el exceso va camión → 99.

**Criterio 99 vs 98 (confirmado por Ariel):** al 99 va lo que volvió roto y se contó (cambios de
clientes y bolsas rotas de más en el camión): merma física. Al 98 va lo que no volvió: diferencias
sin evidencia, que se le cargan al chofer. Si la política cobra al chofer las rotas de más, eso lo
resuelve la liquidación de la app (plata), no el depósito (stock).

**Sobrantes (confirmado con Ariel):** si muelle cuenta más de lo esperado (pallet con bolsas de más,
o un cliente que recibió de menos), se registra una transferencia **98 → camión** por la diferencia
y la descarga mueve TODO lo contado a planta; el camión sigue cerrando en 0 y el 98 queda negativo
para ese chofer (neto faltantes − sobrantes). Muelle no distingue la causa; la investiga la oficina
después (producción o nota de crédito al cliente). La liquidación de la app debe mostrar el
sobrante y permitir anotar la causa.

Por qué dos movimientos: un renglón real a $0 en el remito se facturaría con precio de lista;
un artículo CAMBIO con stock reproduce los negativos de hoy. El renglón CAMBIO resuelve papel y
precio; la transferencia resuelve el stock. Los dos salen del mismo registro del chofer.

## 4. Lo que hay que resolver antes de codear

Decisiones de negocio (Ariel):
1. ~~Aprobar el circuito de §3~~ — aprobado el 2026-09-04 con §3b.
2. ~~Crear el depósito 98~~ — creado el 2026-09-04 en TestingRH, REDONHIELO_SA y Rolito ("DIFERENCIA DE REPARTO", sucursal 1).
3. ~~Artículos `CAMBIO*` sin stock~~ — hecho el 2026-09-04 en las 3 bases (destildar "Lleva stock"
   en la ficha: Tango elimina los saldos STA19 solo). En Rolito hubo que completar antes
   UNIDAD_MEDIDA_AFIP (tenía solo el 95) y cargar UM 7 UNIDAD en los artículos viejos.
4. ~~Arranque~~ — decidido: (a) inventario físico de las plantas un día de corte + ajuste inicial
   en Tango; Ariel confirmó el 2026-09-04 que es viable. Fecha a definir cuando la fase B esté lista.
5. ~~Costeo~~ — contaduría NO valoriza el stock en Tango (solo cantidades); los writers dejan
   PPP/precios en 0 como Bluesoft. Valorizar queda como mejora futura (Ariel, 2026-09-04).

Datos técnicos que faltan:
- `STA13` (talonarios de stock) y la numeración de CAR/DES/CBS/MER: consulta (aa) pendiente.
- Una traza de Extended Events de **una transferencia entre depósitos cargada a mano** en
  TestingRH (mismo método que remito y recibo, script `02-trazar-tango.sql`), para confirmar
  que Tango no escribe nada más que STA14/STA20/STA19/STA13 en una transferencia.
- Depósito de ventanilla y cómo se repone.

## 5. Orden de implementación

1. **Fase A (lista):** REM y REC por SQL. Falta la puesta en producción (talonarios en Redonhielo
   y Rolito, permisos del login en esas bases, servicio como tarea programada, interruptores).
2. **Fase A+ (antes de producción del remito):** renglones CAMBIO en el REM de cta. cte.;
   remito de cambio en la app (papel firmado) para contado con cambios.
3. **Fase B, el ciclo del camión:** writer de transferencia (uno solo sirve para CAR, DES, CBS,
   MER y AJU: cambian el tipo, el talonario, origen/destino y la cabecera). Se conecta a los
   items `transferenciaDeposito` que la app ya encola, más dos items nuevos: `cambio` (por venta
   con cambios) y `ajusteLiquidacion` (por liquidación). Prueba en TestingRH con `--dry-run` y
   luego real, verificando que un camión de prueba cierre en 0.
4. **Fase C:** producción (PDT/PRO desde `produccionPallets`) y mostrador.
5. **Control permanente:** un informe diario en la app que compare, por camión, el stock de
   Tango (STA19) con lo que la app espera (0 al cierre), y avise si hay diferencia.
