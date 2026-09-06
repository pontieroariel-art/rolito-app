// Piezas compartidas por los writers de STOCK directo en la base de Tango
// (remito de ventas y movimientos de stock: egreso / transferencia). Las
// tablas son las mismas (STA14 cabecera, STA20 renglones, STA19 saldos): lo
// que cambia entre un remito y una transferencia son los valores de una
// docena de columnas, así que la cabecera y el renglón se arman acá una sola
// vez y cada writer pasa lo suyo. Los valores por defecto son los de las
// trazas y muestras reales (docs/tango/sql/traza-remito-2026-09-04.txt y
// muestras-stock-2026-09-04.json).

import type { ItemVenta } from '../pedido'
import {
  type EjecutorSql, type SentenciaSql, type ParametroSql,
  varchar, numeric, datetime, bit, int, smallint, float,
  soloDia, horaHHMMSS, FECHA_NULA_TANGO, insert,
} from './tipos'

/** Timestamp de Firestore (admin o cliente), Date, ISO o epoch → Date. Sin dato: ahora. */
export function fechaDePayload(f: unknown): Date {
  if (f instanceof Date) return f
  if (f && typeof f === 'object') {
    const o = f as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof o.toDate === 'function') return o.toDate()
    const s = o.seconds ?? o._seconds
    if (typeof s === 'number') return new Date(s * 1000)
  }
  if (typeof f === 'string' || typeof f === 'number') { const d = new Date(f); if (!isNaN(d.getTime())) return d }
  return new Date()
}

/** Las cantidades de Tango son numeric(22,7): se redondea a 7 decimales para que el WHERE optimista compare igual. */
export const redondear7 = (n: number): number => Math.round(n * 1e7) / 1e7

/**
 * Próximo número interno de stock (STA14.NCOMP_IN_S, 8 dígitos). Tango lo toma
 * como MAX + 1 dentro del tipo interno (traza del 2026-09-05: el egreso VS y la
 * transferencia TI leen "TOP 1 ... WHERE TCOMP_IN_S = X ORDER BY NCOMP_IN_S DESC").
 * Para el remito se conserva el contador INCREMENTAL_VALUE si existe
 * (`usarContador`), como estaba probado en producción.
 */
export async function siguienteNcompInS(db: EjecutorSql, tcompInS: string, usarContador = true): Promise<string> {
  if (usarContador) try {
    const inc = await db.query<{ UltimoValor: number }>(
      `SELECT UltimoValor FROM dbo.INCREMENTAL_VALUE WHERE Tabla = 'STA14' AND Campo = 'NCOMP_IN_S'`,
    )
    if (inc.length) {
      const siguiente = Number(inc[0].UltimoValor) + 1
      await db.query(`UPDATE dbo.INCREMENTAL_VALUE SET UltimoValor = @V WHERE Tabla = 'STA14' AND Campo = 'NCOMP_IN_S' AND UltimoValor = @ANT`, [int('V', siguiente), int('ANT', Number(inc[0].UltimoValor))])
      return String(siguiente).padStart(8, '0')
    }
  } catch { /* sin tabla de contadores → MAX+1 */ }
  const mx = await db.query<{ MAXN: string | null }>(`SELECT MAX(NCOMP_IN_S) AS MAXN FROM STA14 WHERE TCOMP_IN_S = @T`, [varchar('T', tcompInS, 2)])
  return String((Number(mx[0]?.MAXN ?? '0') || 0) + 1).padStart(8, '0')
}

/**
 * Referencia idempotente de una venta en Tango ('ROLITO:VC:<id>' camión,
 * 'ROLITO:VV:<id>' ventanilla). Misma regla que pedido.ts (referenciaPedido);
 * duplicada acá porque esta carpeta se copia sola al servidor (C:RolitoSyncsqllib).
 */
export function referenciaVenta(origenColeccion: string, origenId: string): string {
  return `ROLITO:${origenColeccion === 'ventasVentanilla' ? 'VV' : 'VC'}:${origenId}`
}

/** "00003-00000120" del comprobante interno de la app, o null si salió sin numerar. */
export function numeroInternoDe(ci: { puntoVenta?: number; numero?: number } | null | undefined): string | null {
  if (!ci || typeof ci.numero !== 'number') return null
  return `${String(ci.puntoVenta ?? 0).padStart(5, '0')}-${String(ci.numero).padStart(8, '0')}`
}

export interface RenglonStock {
  codArticu: string
  cantidad: number
}

/**
 * Renglones de stock a partir de listas de ítems de la app (items, cambios…),
 * agregados por artículo REAL de Tango. Un cambio viene como `cambio_<producto>`:
 * si no tiene mapeo propio cae al del producto (la bolsa que se repone es la
 * misma que se vende). Mapeo = config/tango.articulos.
 */
export function renglonesDeItems(listas: (ItemVenta[] | undefined)[], articulos: Record<string, string>): RenglonStock[] {
  const acum = new Map<string, number>()
  for (const lista of listas) {
    for (const it of lista ?? []) {
      const cantidad = Number(it.cantidad)
      if (!(cantidad > 0)) continue
      let cod = articulos[it.productoId]
      if (!cod && it.productoId.startsWith('cambio_')) cod = articulos[it.productoId.slice('cambio_'.length)]
      if (!cod) throw new Error(`producto ${it.productoId} sin artículo de Tango en config/tango.articulos`)
      acum.set(cod, redondear7((acum.get(cod) ?? 0) + cantidad))
    }
  }
  return [...acum.entries()].map(([codArticu, cantidad]) => ({ codArticu, cantidad }))
}

/**
 * Número de un comprobante de STOCK como lo guarda Tango en STA14.N_COMP
 * (varchar 14): un ESPACIO + sucursal del talonario (5) + número (8), por ejemplo
 * ' 0090000000001' (traza del 2026-09-05, igual en el egreso VPR y en la
 * transferencia TRA). Los que grababa Bluesoft usaban 4 dígitos de sucursal y sin
 * espacio; el ancho queda parametrizado por si hace falta leerlos.
 */
export function numeroComprobanteStock(sucursal: number, numero: number, anchoSucursal = 5): string {
  return `${anchoSucursal === 5 ? ' ' : ''}${String(sucursal).padStart(anchoSucursal, '0')}${String(numero).padStart(8, '0')}`
}

/** Lo que varía entre una cabecera STA14 y otra. Todo lo demás son los "vacíos" de Tango ('', 0, 1800-01-01). */
export interface CabeceraSta14 {
  tComp: string
  tcompInS: string
  talonario: number
  nComp: string
  /** Solo el remito lleva N_REMITO (= N_COMP). Los movimientos de stock lo dejan vacío. */
  nRemito?: string
  ncompInS: string
  /** COD_PRO_CL: cliente (remito, egreso por venta). Vacío en una transferencia. */
  codCliente?: string
  /** Depósito de la cabecera (remito, egreso). Vacío en una transferencia: los depósitos van por renglón. */
  codDeposito?: string
  /** 'P' = remito pendiente de facturar. Los movimientos de stock no tienen estado. */
  estadoMov?: string
  /** 'V' = remito por venta. */
  motivoRem?: string
  codTransp?: string
  fecha: Date
  ahora: Date
  usuario: string
  terminal: string
  /** LEYENDA1..5 (varchar 60). La 1 es la referencia idempotente ('ROLITO:VC:<id>'). */
  leyendas: string[]
  observacion?: string
  idDireccionEntrega?: number | null
  nroSucursalDestino?: number
  condVta?: number
  /**
   * HORA_ANU / USUARIO_ANU / TERMINAL_ANU: el remito los graba '' y los
   * movimientos de stock NULL (traza 2026-09-05).
   */
  anulacionNull?: boolean
}

/** INSERT STA14 con las 60 columnas que graba Tango (misma lista y orden que la traza del remito). */
export function cabeceraSta14(c: CabeceraSta14): SentenciaSql {
  const fechaMov = soloDia(c.fecha)
  const hoy = soloDia(c.ahora)
  const hora = horaHHMMSS(c.ahora)
  const ley = (i: number): ParametroSql => {
    const v = (c.leyendas[i - 1] ?? '').slice(0, 60)
    return varchar(`LEYENDA${i}`, v, v ? 60 : 1)
  }
  const obs = (c.observacion ?? '').slice(0, 60)
  return insert('INSERT STA14', 'STA14', [
    varchar('FILLER', '', 1),
    varchar('COD_PRO_CL', c.codCliente ?? '', c.codCliente ? 6 : 1),
    numeric('COTIZ', 1),
    varchar('ESTADO_MOV', c.estadoMov ?? '', 1),
    bit('EXPORTADO', false),
    bit('EXP_STOCK', false),
    datetime('FECHA_ANU', FECHA_NULA_TANGO),
    datetime('FECHA_MOV', fechaMov),
    varchar('HORA', '0000', 4),
    smallint('LISTA_REM', 0),
    float('LOTE', 0),
    float('LOTE_ANU', 0),
    bit('MON_CTE', true),
    varchar('MOTIVO_REM', c.motivoRem ?? '', 1),
    varchar('N_COMP', c.nComp, 14),
    varchar('N_REMITO', c.nRemito ?? '', c.nRemito ? 14 : 1),
    varchar('NCOMP_IN_S', c.ncompInS, 8),
    varchar('NCOMP_ORIG', '', 1),
    smallint('NRO_SUCURS', 0),
    varchar('OBSERVACIO', obs, obs ? 60 : 1),
    smallint('SUC_ORIG', 0),
    varchar('T_COMP', c.tComp, 3),
    smallint('TALONARIO', c.talonario),
    varchar('TCOMP_IN_S', c.tcompInS, 2),
    varchar('TCOMP_ORIG', '', 1),
    varchar('USUARIO', c.usuario.slice(0, 10), 10),
    varchar('COD_TRANSP', c.codTransp ?? '', c.codTransp ? 2 : 1),
    varchar('HORA_COMP', hora, 6),
    float('ID_A_RENTA', 0),
    bit('DOC_ELECTR', false),
    varchar('COD_CLASIF', '', 1),
    varchar('AUDIT_IMP', '', 1),
    numeric('IMP_IVA', 0),
    numeric('IMP_OTIMP', 0),
    numeric('IMPORTE_BO', 0),
    numeric('IMPORTE_TO', 0),
    varchar('DIFERENCIA', 'N', 1),
    smallint('SUC_DESTIN', 0),
    varchar('T_DOC_DTE', '', 1),
    ley(1), ley(2), ley(3), ley(4), ley(5),
    numeric('DCTO_CLIEN', 0),
    varchar('T_INT_ORI', '', 1),
    varchar('N_INT_ORI', '', 1),
    datetime('FECHA_INGRESO', hoy),
    varchar('HORA_INGRESO', hora, 6),
    varchar('USUARIO_INGRESO', c.usuario.slice(0, 10), 10),
    varchar('TERMINAL_INGRESO', c.terminal.slice(0, 8), 8),
    numeric('IMPORTE_TOTAL_CON_IMPUESTOS', 0),
    numeric('CANTIDAD_KILOS', 0),
    int('ID_DIRECCION_ENTREGA', c.idDireccionEntrega ?? null),
    smallint('NRO_SUCURSAL_DESTINO_REMITO', c.nroSucursalDestino ?? 0),
    varchar('COD_DEPOSI', c.codDeposito ?? '', c.codDeposito ? 2 : 1),
    smallint('COND_VTA', c.condVta ?? 0),
    // Tango deja en estos tres la hora/usuario/terminal de la sesión aunque el
    // remito no esté anulado (dato residual de su pantalla); en los movimientos
    // de stock los graba NULL. Acá: vacíos o NULL según el comprobante.
    varchar('HORA_ANU', c.anulacionNull ? null : '', c.anulacionNull ? 1 : 6),
    varchar('USUARIO_ANU', c.anulacionNull ? null : '', c.anulacionNull ? 1 : 10),
    varchar('TERMINAL_ANU', c.anulacionNull ? null : '', c.anulacionNull ? 1 : 8),
  ], true)
}

export interface RenglonSta20 {
  etiqueta: string
  codArticu: string
  cantidad: number
  /** 'S' salida / 'E' entrada. */
  tipoMov: 'S' | 'E'
  codDeposito: string
  /** Transferencia: el otro depósito del par (Tango lo graba en los dos renglones). */
  depositoDesde?: string
  nRenglon: number
  tcompInS: string
  ncompInS: string
  fecha: Date
  idMedidaStock: number
  idMedidaVentas: number | null
  /** Remito: queda pendiente de facturar (= cantidad). Movimientos de stock: 0. */
  cantPendiente?: number
  /** Tango graba 1 en el remito sin precios y 0 en las transferencias (muestras). */
  impuestoInternoFijo?: number
}

/** INSERT STA20 con las 50 columnas que graba Tango. */
export function renglonSta20(r: RenglonSta20): SentenciaSql {
  return insert(r.etiqueta, 'STA20', [
    varchar('FILLER', '', 1),
    numeric('CAN_EQUI_V', r.cantidad),
    numeric('CANT_DEV', 0),
    numeric('CANT_OC', 0),
    numeric('CANT_PEND', r.cantPendiente ?? 0),
    numeric('CANT_SCRAP', 0),
    numeric('CANTIDAD', r.cantidad),
    numeric('CANT_FACTU', 0),
    varchar('COD_ARTICU', r.codArticu, 15),
    varchar('COD_DEPOSI', r.codDeposito, 2),
    varchar('DEPOSI_DDE', r.depositoDesde ?? '', r.depositoDesde ? 2 : 1),
    numeric('EQUIVALENC', 1),
    datetime('FECHA_MOV', soloDia(r.fecha)),
    varchar('N_ORDEN_CO', '', 1),
    int('N_RENGL_OC', 0),
    int('N_RENGL_S', r.nRenglon),
    varchar('NCOMP_IN_S', r.ncompInS, 8),
    numeric('PLISTA_REM', 0),
    numeric('PPP_EX', 0),
    numeric('PPP_LO', 0),
    numeric('PRECIO', 0),
    numeric('PRECIO_REM', 0),
    varchar('TCOMP_IN_S', r.tcompInS, 2),
    varchar('TIPO_MOV', r.tipoMov, 1),
    varchar('COD_CLASIF', '', 1),
    numeric('DCTO_FACTU', 0),
    numeric('CANT_DEV_2', 0),
    numeric('CANT_PEND_2', 0),
    numeric('CANTIDAD_2', 0),
    numeric('CANT_FACTU_2', 0),
    numeric('CANT_OC_2', 0),
    int('ID_MEDIDA_STOCK_2', null),
    int('ID_MEDIDA_STOCK', r.idMedidaStock),
    int('ID_MEDIDA_VENTAS', r.idMedidaVentas),
    int('ID_MEDIDA_COMPRA', null),
    varchar('UNIDAD_MEDIDA_SELECCIONADA', 'P', 1),
    numeric('PRECIO_REMITO_VENTAS', 0),
    int('RENGL_PADR', 0),
    varchar('COD_ARTICU_KIT', '', 1),
    bit('PROMOCION', false),
    smallint('TALONARIO_OC', 0),
    varchar('COD_DEPOSI_INGRESO', '', 1),
    varchar('OBSERVACIONES', '', 1),
    numeric('IMPUESTO_INTERNO_FIJO', r.impuestoInternoFijo ?? 0),
    numeric('IMPORTE_SIN_IMPUESTOS', 0),
    numeric('IMPORTE_CON_IMPUESTOS', 0),
    numeric('BASE_CALCULO_II_VARIABLE', 0),
    numeric('CANTIDAD_PARTIDAS', 0),
    numeric('CANTIDAD_PARTIDAS_2', 0),
    varchar('NRO_OC_COMP', '', 1),
  ], true)
}

/**
 * UPDATE del saldo de un depósito (STA19) con la misma concurrencia optimista de
 * Tango: el WHERE lleva el CANT_STOCK leído; si otro movimiento lo cambió en el
 * medio, afecta 0 filas y el writer aborta la transacción (el reintento relee).
 * `delta` negativo descuenta, positivo suma.
 */
export function updateSta19(etiqueta: string, codArticu: string, codDeposito: string, stockAnterior: number, delta: number): SentenciaSql {
  return {
    etiqueta,
    sql: `UPDATE "STA19" SET "CANT_STOCK" = @CANT_NUEVA WHERE "COD_ARTICU" = @COD_ARTICU AND "COD_DEPOSI" = @COD_DEPOSI AND "CANT_STOCK" = @CANT_ANTERIOR AND "COD_UBIC1" = '' AND "COD_UBIC2" = '' AND "COD_UBIC3" = ''`,
    params: [
      numeric('CANT_NUEVA', redondear7(stockAnterior + delta)),
      varchar('COD_ARTICU', codArticu, 15),
      varchar('COD_DEPOSI', codDeposito, 2),
      numeric('CANT_ANTERIOR', stockAnterior),
    ],
  }
}

/** Unidades de medida de un artículo (STA11). Error claro si no existe. */
export async function leerArticulo(db: EjecutorSql, codArticu: string): Promise<{ idMedidaStock: number; idMedidaVentas: number }> {
  const art = await db.query<{ ID_MEDIDA_STOCK: number; ID_MEDIDA_VENTAS: number }>(
    `SELECT ID_MEDIDA_STOCK, ID_MEDIDA_VENTAS FROM STA11 WHERE COD_ARTICU = @COD`, [varchar('COD', codArticu, 15)],
  )
  if (!art.length) throw new Error(`artículo ${codArticu} no existe en Tango`)
  return { idMedidaStock: art[0].ID_MEDIDA_STOCK, idMedidaVentas: art[0].ID_MEDIDA_VENTAS }
}

/** Saldo actual de un artículo en un depósito (STA19, sin ubicaciones). `null` si no hay fila. */
export async function leerStock(db: EjecutorSql, codArticu: string, codDeposito: string): Promise<number | null> {
  const stock = await db.query<{ CANT_STOCK: number }>(
    `SELECT CANT_STOCK FROM STA19 WHERE COD_ARTICU = @COD AND COD_DEPOSI = @DEP AND COD_UBIC1 = '' AND COD_UBIC2 = '' AND COD_UBIC3 = ''`,
    [varchar('COD', codArticu, 15), varchar('DEP', codDeposito, 2)],
  )
  return stock.length ? Number(stock[0].CANT_STOCK) : null
}
