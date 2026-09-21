# Anular un remito de ventas en Tango — qué hace exactamente

**Trazado en producción el 2026-09-20** sobre `R0110500000957` (KLIVE S.A., `IR.023`,
depósito 06, 3 renglones de 40 + 20 + 20), anulado a mano desde *Tango Ventas → Anulación
de remitos* mientras corría una sesión de Extended Events
(`scripts/tango/sql/19-trazar-anulacion-remito.sql`).

Sirve para escribir el writer que anule solo en Tango el remito que el chofer anula en la
app, y sacar de encima el camino "la oficina lo hace a mano", que es donde hoy se pierden
días y donde tres remitos terminaron facturados antes de que alguien llegara.

## Cómo encuentra Tango el remito (y por qué la pantalla decía "REMITO INEXISTENTE")

El número que arma la pantalla es de **14 caracteres**: `letra + punto de venta (5) +
número (8)`. En el campo "Nro. de Remito" **la letra va adentro del primer casillero**:
hay que tipear `R01105` y `00000957`, no `01105`. Con `01105` Tango manda
`' 0110500000957'` (un espacio donde va la letra) y no encuentra nada.

## La secuencia

Claves que usa todo el tiempo: `TCOMP_IN_S` + `NCOMP_IN_S` (el comprobante interno de
stock, acá `'RE'` + `'00408839'`) y `N_RENGL_S`. El `ID_STA14` es 891840.

**Por cada renglón** (1, 2, 3):

1. `UPDATE STA19 SET CANT_STOCK = CANT_STOCK + <cantidad del renglón>` — **devuelve el
   stock al depósito**. Se ubica la fila por `COD_ARTICU` + `COD_DEPOSI`.
   Medido: `-11714 → -11674` (+40), `-109 → -89` (+20), `-50 → -30` (+20).
   OJO: hay un **trigger** en STA19 que recalcula `ID_STA22` e `ID_STA11` solo. No tocarlos.
2. `DELETE FROM STA09 WHERE TCOMP_IN_S=… AND NCOMP_IN_S=… AND N_RENGL_S=…`
3. `DELETE FROM STA07 …` (series / partidas)
4. `DELETE FROM GVA106 …`
5. `DELETE FROM GVA54 …` — la relación remito ↔ factura

**Una sola vez, al final:**

6. `DELETE FROM STA20 WHERE TCOMP_IN_S='RE' AND NCOMP_IN_S='00408839'` — **los renglones se
   borran**; el remito no se elimina, se vacía.
7. `DELETE FROM GVA45 WHERE TALONARIO=1105 AND T_COMP='REM' AND N_COMP='R0110500000957'`
8. `DELETE FROM GVA55 WHERE T_COMP='REM' AND N_COMP='R0110500000957'`
9. `UPDATE STA14` de la cabecera (`WHERE ID_STA14 = …`):

| Campo | Antes | Después |
|---|---|---|
| `ESTADO_MOV` | `P` | `A` |
| `FECHA_ANU` | `1800-01-01` | fecha de la anulación (solo fecha) |
| `HORA_ANU` | vacío | `HHMMSS` (`193635`) |
| `USUARIO_ANU` | vacío | usuario de Tango (`SUPERVISOR`) |
| `TERMINAL_ANU` | vacío | nombre de la máquina (`RHIELOTG`) |
| `COD_PRO_CL` | `IR.023` | **`IR.023` — NO se toca** |
| `LEYENDA1..3` | las de la app | intactas |

## Lo que NO pasa

- **El cliente no se borra.** Al contrario de lo que hace con los recibos (ver el caso
  FERRANTE), Tango deja el `COD_PRO_CL` del remito. Por eso el remito anulado sigue
  apareciendo en la ficha del cliente con estado `A`, y la reconciliación de la app por el
  índice del cliente funciona bien para remitos.
- No se toca la cuenta corriente: un remito no la mueve.

## Para el writer

- Todo en **una transacción**: si falla a la mitad, el stock queda devuelto y el remito vivo.
- **Idempotente**: si `ESTADO_MOV` ya es `A`, no hacer nada y devolver ok.
- **Solo con `ESTADO_MOV = 'P'`**. Si está en `F` el remito ya está facturado: no se toca y
  se avisa a facturación, que primero tiene que anular la factura.
- `USUARIO_ANU` / `TERMINAL_ANU`: poner algo que se distinga a simple vista (`APP`), para
  que en Tango se vea quién anuló qué.
- Interruptor por tipo en `config/tango`, dry-run antes de prender, y write-back del
  resultado a `ventasCamion.anulacion.tango`.

## El writer (2026-09-20)

- **Lógica pura y tests:** `functions/src/services/tango/sql/anulacionRemito.ts`
  (+ `.test.ts`, con los números medidos arriba). `anularRemitoEnTango(db, nComp, cfg)`
  devuelve `anulado` · `ya_anulado` · `facturado` · `inexistente`, sin lanzar: cada caso
  tiene su tratamiento aguas arriba.
- **Quién lo ejecuta:** el bridge de la VM (`scripts/tango/bridge-sql.mjs`), entidad
  `anulacionRemito` de `tango-outbox`, dentro de una transacción como los demás writers.
- **Quién lo encola:** `onVentaCamionAnulada`, apenas el remito queda anulado en la app.
  Si el interruptor está apagado o el remito nunca llegó a Tango, sigue el camino viejo
  (`pendiente_oficina` + push a facturación).
- **Interruptor:** `config/tango.anulacionRemitoSqlEnabled`, arranca en **false**.
- **Write-back:** `anulacion.tango.estado` → `confirmado` (anulado / ya anulado) o
  `pendiente_oficina` (facturado / inexistente / error), con `resultado` para saber cuál fue.
- **El que queda a medio camino no se pierde:** la reconciliación horaria mira también los
  `encolado`, así que si el bridge estuvo caído la venta se confirma igual cuando Tango
  muestre el remito anulado.

### Encendido

1. Copiar `functions/lib/services/tango/sql/anulacionRemito.js` a `C:\RolitoSync\sql\lib\`
   junto a los otros, y reiniciar el bridge.
2. `config/tango.anulacionRemitoSqlEnabled = false` todavía, y probar con
   `node bridge-sql.mjs --dry-run --solo=<id del item>`: ejecuta todo y **revierte**.
3. Comparar la salida contra esta receta (mismas tablas, mismo orden, el stock que vuelve).
4. Recién ahí prender el interruptor.

Quedan tres remitos en `F` (facturados) del 12 al 16/09: ésos no los toca el writer y
siguen necesitando que alguien decida qué hacer con la factura.
