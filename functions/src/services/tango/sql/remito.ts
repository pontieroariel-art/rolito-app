// Remito de ventas directo en la base de Tango (STA14 / STA20 / STA19), copiando
// exactamente lo que hace la pantalla "Emisión de remitos" — relevado con una
// traza de Extended Events el 2026-09-04 (docs/tango/sql/traza-remito-2026-09-04.txt).
//
// Qué escribe Tango al grabar un remito, en orden:
//   1. INSERT STA14  cabecera (T_COMP 'REM', TCOMP_IN_S 'RE', NCOMP_IN_S = nº interno
//      de stock de 8 dígitos, N_COMP/N_REMITO = 'R' + pto vta (5) + número (8),
//      ESTADO_MOV 'P' = pendiente de facturar, MOTIVO_REM 'V' = venta).
//      Triggers de Tango completan solos ID_STA13 (talonario) e ID_GVA14 (cliente).
//   2. INSERT STA20  un renglón por artículo (TIPO_MOV 'S' = salida, CANTIDAD y
//      CANT_PEND iguales, ID_MEDIDA_STOCK/VENTAS del artículo). Triggers completan
//      ID_STA11 (artículo) e ID_STA14 (cabecera, por TCOMP_IN_S + NCOMP_IN_S).
//   3. UPDATE STA19  descuenta el stock del depósito con concurrencia optimista
//      (WHERE con el CANT_STOCK anterior). Triggers completan ID_STA22 / ID_STA11.
//   4. INSERT STA14TY la imagen del talonario para reimprimir. NO se replica: la app
//      imprime su propio remito; Tango lo toma igual sin esa fila (a verificar en la
//      prueba de TestingRH — si la reimpresión desde Tango falla, se agrega).
//
// Lo que NO hace Tango acá y por eso tampoco nosotros: tocar la cuenta corriente
// (el remito no es un comprobante de cta. cte.), ni GVA43 (el número lo tipeó el
// operador; para la app el talonario 1105 es exclusivo y la numeración es nuestra).
//
// Idempotencia: antes de insertar se busca STA14 por T_COMP + N_COMP; si existe, se
// devuelve sin escribir. Un reintento nunca duplica.

import type { PayloadVenta, ItemVenta } from '../pedido'
import {
  type EjecutorSql, type SentenciaSql, type ParametroSql,
  varchar, numeric, datetime, bit, int, smallint, float,
  soloDia, horaHHMMSS, FECHA_NULA_TANGO, numeroComprobanteTango, insert,
} from './tipos'

/** Configuración del writer SQL de remitos (config/tango.sql.remito). */
export interface ConfigRemitoSql {
  /** Talonario de Tango del remito de la app (Redonhielo: 1105 "Remito R App Rolito"). */
  talonario: number
  /** Punto de venta del talonario (01105). Debe coincidir con config/numeracionInterna_remito. */
  puntoVenta: number
  /** Código de transporte de Tango que se graba en el remito (Tango usa '01'). */
  codigoTransporte: string
  /** Usuario / terminal que quedan como autor del comprobante en Tango (varchar 10 / 8). */
  usuario: string
  terminal: string
}

/** Datos que hay que LEER de Tango antes de armar las sentencias (ver leerDatosRemito). */
export interface DatosRemito {
  /** Próximo número interno de stock (NCOMP_IN_S), 8 dígitos. */
  ncompInS: string
  /** Condición de venta del cliente (GVA14.COND_VTA). */
  condVta: number
  /** Dirección de entrega habitual del cliente (STA14.ID_DIRECCION_ENTREGA) y su nro de sucursal. */
  idDireccionEntrega: number | null
  nroSucursalDestino: number
  /** Por artículo: unidades de medida y stock actual en el depósito (para el UPDATE optimista). */
  articulos: Record<string, { idMedidaStock: number; idMedidaVentas: number; stockActual: number }>
}

export interface RenglonRemito {
  codArticu: string
  cantidad: number
}

export interface RemitoTango {
  numero: number
  puntoVenta: number
  nComp: string          // 'R0000100480100'
  codCliente: string     // COD_GVA14
  codDeposito: string    // STA22.COD_STA22 del repartidor
  fecha: Date
  renglones: RenglonRemito[]
  observacion: string    // referencia idempotente ROLITO:VC:<id> (OBSERVACIO, varchar 1? → LEYENDA1)
}

/**
 * Del payload de la venta (tango-outbox) al remito de Tango. Los cambios (bolsas
 * repuestas sin cargo) también salen del depósito, así que van como renglones.
 * Los artículos se mapean con config/tango.articulos igual que en el pedido/factura.
 */
export function remitoDeVenta(
  payload: PayloadVenta,
  origenId: string,
  articulos: Record<string, string>,
  codDeposito: string,
  puntoVenta: number,
): RemitoTango {
  const ci = payload.comprobanteInterno
  if (!ci || ci.tipo !== 'remito' || !ci.numero) throw new Error('la venta no tiene remito interno numerado (comprobanteInterno.tipo=remito)')
  if (!payload.clienteCodigoTango) throw new Error('la venta no tiene clienteCodigoTango')
  const pv = ci.puntoVenta ?? puntoVenta
  const renglones = new Map<string, number>()
  const sumar = (items: ItemVenta[] | undefined) => {
    for (const it of items ?? []) {
      const cod = articulos[it.productoId]
      if (!cod) throw new Error(`producto ${it.productoId} sin artículo de Tango en config/tango.articulos`)
      renglones.set(cod, (renglones.get(cod) ?? 0) + Number(it.cantidad))
    }
  }
  sumar(payload.items)
  sumar(payload.cambios)
  if (renglones.size === 0) throw new Error('remito sin renglones')
  const fecha = fechaDePayload(payload.fecha)
  return {
    numero: ci.numero,
    puntoVenta: pv,
    nComp: numeroComprobanteTango('R', pv, ci.numero),
    codCliente: payload.clienteCodigoTango,
    codDeposito,
    fecha,
    renglones: [...renglones.entries()].map(([codArticu, cantidad]) => ({ codArticu, cantidad })),
    observacion: `ROLITO:VC:${origenId}`,
  }
}

function fechaDePayload(f: unknown): Date {
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

/** ¿Ya existe este remito en Tango? (idempotencia: T_COMP + N_COMP). */
export function sentenciaExiste(r: RemitoTango): SentenciaSql {
  return {
    etiqueta: 'SELECT STA14 existe',
    sql: `SELECT ID_STA14, NCOMP_IN_S FROM STA14 WHERE T_COMP = 'REM' AND N_COMP = @N_COMP`,
    params: [varchar('N_COMP', r.nComp, 14)],
  }
}

/**
 * Las sentencias de escritura, en el orden en que las hace Tango. Puras: no tocan la
 * base. `datos` viene de leerDatosRemito (o del test).
 */
export function sentenciasRemito(r: RemitoTango, datos: DatosRemito, cfg: ConfigRemitoSql, ahora = new Date()): SentenciaSql[] {
  const fechaMov = soloDia(r.fecha)
  const hoy = soloDia(ahora)
  const hora = horaHHMMSS(ahora)
  const out: SentenciaSql[] = []

  // 1. Cabecera — mismas 60 columnas y valores que la traza (los "vacíos" de Tango son '', 0 o 1800-01-01).
  out.push(insert('INSERT STA14', 'STA14', [
    varchar('FILLER', '', 1),
    varchar('COD_PRO_CL', r.codCliente, 6),
    numeric('COTIZ', 1),
    varchar('ESTADO_MOV', 'P', 1),
    bit('EXPORTADO', false),
    bit('EXP_STOCK', false),
    datetime('FECHA_ANU', FECHA_NULA_TANGO),
    datetime('FECHA_MOV', fechaMov),
    varchar('HORA', '0000', 4),
    smallint('LISTA_REM', 0),
    float('LOTE', 0),
    float('LOTE_ANU', 0),
    bit('MON_CTE', true),
    varchar('MOTIVO_REM', 'V', 1),
    varchar('N_COMP', r.nComp, 14),
    varchar('N_REMITO', r.nComp, 14),
    varchar('NCOMP_IN_S', datos.ncompInS, 8),
    varchar('NCOMP_ORIG', '', 1),
    smallint('NRO_SUCURS', 0),
    varchar('OBSERVACIO', '', 1),
    smallint('SUC_ORIG', 0),
    varchar('T_COMP', 'REM', 3),
    smallint('TALONARIO', cfg.talonario),
    varchar('TCOMP_IN_S', 'RE', 2),
    varchar('TCOMP_ORIG', '', 1),
    varchar('USUARIO', cfg.usuario.slice(0, 10), 10),
    varchar('COD_TRANSP', cfg.codigoTransporte, 2),
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
    // La referencia idempotente va en LEYENDA1 (varchar 60): se lee desde Tango y
    // sirve para cruzar contra ventasCamion sin depender solo del número.
    varchar('LEYENDA1', r.observacion.slice(0, 60), 60),
    varchar('LEYENDA2', '', 1),
    varchar('LEYENDA3', '', 1),
    varchar('LEYENDA4', '', 1),
    varchar('LEYENDA5', '', 1),
    numeric('DCTO_CLIEN', 0),
    varchar('T_INT_ORI', '', 1),
    varchar('N_INT_ORI', '', 1),
    datetime('FECHA_INGRESO', hoy),
    varchar('HORA_INGRESO', hora, 6),
    varchar('USUARIO_INGRESO', cfg.usuario.slice(0, 10), 10),
    varchar('TERMINAL_INGRESO', cfg.terminal.slice(0, 8), 8),
    numeric('IMPORTE_TOTAL_CON_IMPUESTOS', 0),
    numeric('CANTIDAD_KILOS', 0),
    int('ID_DIRECCION_ENTREGA', datos.idDireccionEntrega),
    smallint('NRO_SUCURSAL_DESTINO_REMITO', datos.nroSucursalDestino),
    varchar('COD_DEPOSI', r.codDeposito, 2),
    smallint('COND_VTA', datos.condVta),
    // Tango deja en estos tres la hora/usuario/terminal de la sesión aunque el remito
    // no esté anulado (dato residual de su pantalla). Acá van vacíos: es un remito vigente.
    varchar('HORA_ANU', '', 6),
    varchar('USUARIO_ANU', '', 10),
    varchar('TERMINAL_ANU', '', 8),
  ], true))

  // 2. Renglones.
  r.renglones.forEach((ren, i) => {
    const art = datos.articulos[ren.codArticu]
    if (!art) throw new Error(`falta leer el artículo ${ren.codArticu} de Tango (unidades / stock)`)
    out.push(insert(`INSERT STA20 ${ren.codArticu}`, 'STA20', [
      varchar('FILLER', '', 1),
      numeric('CAN_EQUI_V', ren.cantidad),
      numeric('CANT_DEV', 0),
      numeric('CANT_OC', 0),
      numeric('CANT_PEND', ren.cantidad),
      numeric('CANT_SCRAP', 0),
      numeric('CANTIDAD', ren.cantidad),
      numeric('CANT_FACTU', 0),
      varchar('COD_ARTICU', ren.codArticu, 15),
      varchar('COD_DEPOSI', r.codDeposito, 2),
      varchar('DEPOSI_DDE', '', 1),
      numeric('EQUIVALENC', 1),
      datetime('FECHA_MOV', fechaMov),
      varchar('N_ORDEN_CO', '', 1),
      int('N_RENGL_OC', 0),
      int('N_RENGL_S', i + 1),
      varchar('NCOMP_IN_S', datos.ncompInS, 8),
      numeric('PLISTA_REM', 0),
      numeric('PPP_EX', 0),
      numeric('PPP_LO', 0),
      numeric('PRECIO', 0),
      numeric('PRECIO_REM', 0),
      varchar('TCOMP_IN_S', 'RE', 2),
      varchar('TIPO_MOV', 'S', 1),
      varchar('COD_CLASIF', '', 1),
      numeric('DCTO_FACTU', 0),
      numeric('CANT_DEV_2', 0),
      numeric('CANT_PEND_2', 0),
      numeric('CANTIDAD_2', 0),
      numeric('CANT_FACTU_2', 0),
      numeric('CANT_OC_2', 0),
      int('ID_MEDIDA_STOCK_2', null),
      int('ID_MEDIDA_STOCK', art.idMedidaStock),
      int('ID_MEDIDA_VENTAS', art.idMedidaVentas),
      int('ID_MEDIDA_COMPRA', null),
      varchar('UNIDAD_MEDIDA_SELECCIONADA', 'P', 1),
      numeric('PRECIO_REMITO_VENTAS', 0),
      int('RENGL_PADR', 0),
      varchar('COD_ARTICU_KIT', '', 1),
      bit('PROMOCION', false),
      smallint('TALONARIO_OC', 0),
      varchar('COD_DEPOSI_INGRESO', '', 1),
      varchar('OBSERVACIONES', '', 1),
      numeric('IMPUESTO_INTERNO_FIJO', 1),   // así lo graba Tango en un remito sin precios
      numeric('IMPORTE_SIN_IMPUESTOS', 0),
      numeric('IMPORTE_CON_IMPUESTOS', 0),
      numeric('BASE_CALCULO_II_VARIABLE', 0),
      numeric('CANTIDAD_PARTIDAS', 0),
      numeric('CANTIDAD_PARTIDAS_2', 0),
      varchar('NRO_OC_COMP', '', 1),
    ], true))
  })

  // 3. Stock del depósito, con la misma concurrencia optimista de Tango: si otro
  //    movimiento cambió CANT_STOCK entre la lectura y el UPDATE, afecta 0 filas y el
  //    writer aborta la transacción (el reintento vuelve a leer).
  for (const ren of r.renglones) {
    const art = datos.articulos[ren.codArticu]!
    out.push({
      etiqueta: `UPDATE STA19 stock ${ren.codArticu}`,
      sql: `UPDATE "STA19" SET "CANT_STOCK" = @CANT_NUEVA WHERE "COD_ARTICU" = @COD_ARTICU AND "COD_DEPOSI" = @COD_DEPOSI AND "CANT_STOCK" = @CANT_ANTERIOR AND "COD_UBIC1" = '' AND "COD_UBIC2" = '' AND "COD_UBIC3" = ''`,
      params: [
        numeric('CANT_NUEVA', redondear7(art.stockActual - ren.cantidad)),
        varchar('COD_ARTICU', ren.codArticu, 15),
        varchar('COD_DEPOSI', r.codDeposito, 2),
        numeric('CANT_ANTERIOR', art.stockActual),
      ],
    })
  }
  return out
}

const redondear7 = (n: number) => Math.round(n * 1e7) / 1e7

/**
 * Lee de Tango lo que las sentencias necesitan. Las consultas marcadas (*) son la
 * mejor hipótesis sobre el esquema y se confirman en la prueba de TestingRH
 * (docs/tango/INTEGRACION.md §21, "preguntas abiertas").
 */
export async function leerDatosRemito(db: EjecutorSql, r: RemitoTango): Promise<DatosRemito> {
  // Cliente: condición de venta e id.
  const cli = await db.query<{ ID_GVA14: number; COND_VTA: number }>(
    `SELECT ID_GVA14, COND_VTA FROM GVA14 WHERE COD_GVA14 = @COD`, [varchar('COD', r.codCliente, 6)],
  )
  if (!cli.length) throw new Error(`cliente ${r.codCliente} no existe en Tango`)

  // (*) Dirección de entrega habitual del cliente. Tango la graba en STA14 (8470 en la traza).
  let idDireccionEntrega: number | null = null
  let nroSucursalDestino = 0
  try {
    const dir = await db.query<{ ID_DIRECCION_ENTREGA: number; NRO_SUCURSAL: number | null }>(
      `SELECT TOP 1 ID_DIRECCION_ENTREGA, NRO_SUCURSAL FROM DIRECCION_ENTREGA WHERE ID_GVA14 = @ID ORDER BY CASE WHEN HABITUAL = 'S' THEN 0 ELSE 1 END, ID_DIRECCION_ENTREGA`,
      [int('ID', cli[0].ID_GVA14)],
    )
    if (dir.length) { idDireccionEntrega = dir[0].ID_DIRECCION_ENTREGA; nroSucursalDestino = Number(dir[0].NRO_SUCURSAL ?? 0) }
  } catch { /* si la tabla se llama distinto, queda NULL y lo revisamos en la prueba */ }

  // (*) Número interno de stock: contador de Tango si existe, si no MAX + 1.
  let ncompInS: string | null = null
  try {
    const inc = await db.query<{ UltimoValor: number }>(
      `SELECT UltimoValor FROM dbo.INCREMENTAL_VALUE WHERE Tabla = 'STA14' AND Campo = 'NCOMP_IN_S'`,
    )
    if (inc.length) {
      const siguiente = Number(inc[0].UltimoValor) + 1
      await db.query(`UPDATE dbo.INCREMENTAL_VALUE SET UltimoValor = @V WHERE Tabla = 'STA14' AND Campo = 'NCOMP_IN_S' AND UltimoValor = @ANT`, [int('V', siguiente), int('ANT', Number(inc[0].UltimoValor))])
      ncompInS = String(siguiente).padStart(8, '0')
    }
  } catch { /* sin tabla de contadores → MAX+1 */ }
  if (!ncompInS) {
    const mx = await db.query<{ MAXN: string | null }>(`SELECT MAX(NCOMP_IN_S) AS MAXN FROM STA14 WHERE TCOMP_IN_S = 'RE'`)
    ncompInS = String((Number(mx[0]?.MAXN ?? '0') || 0) + 1).padStart(8, '0')
  }

  // Artículos: unidades de medida y stock actual en el depósito.
  const articulos: DatosRemito['articulos'] = {}
  for (const ren of r.renglones) {
    const art = await db.query<{ ID_MEDIDA_STOCK: number; ID_MEDIDA_VENTAS: number }>(
      `SELECT ID_MEDIDA_STOCK, ID_MEDIDA_VENTAS FROM STA11 WHERE COD_ARTICU = @COD`, [varchar('COD', ren.codArticu, 15)],
    )
    if (!art.length) throw new Error(`artículo ${ren.codArticu} no existe en Tango`)
    const stock = await db.query<{ CANT_STOCK: number }>(
      `SELECT CANT_STOCK FROM STA19 WHERE COD_ARTICU = @COD AND COD_DEPOSI = @DEP AND COD_UBIC1 = '' AND COD_UBIC2 = '' AND COD_UBIC3 = ''`,
      [varchar('COD', ren.codArticu, 15), varchar('DEP', r.codDeposito, 2)],
    )
    if (!stock.length) throw new Error(`el artículo ${ren.codArticu} no tiene saldo de stock en el depósito ${r.codDeposito} (STA19)`)
    articulos[ren.codArticu] = { idMedidaStock: art[0].ID_MEDIDA_STOCK, idMedidaVentas: art[0].ID_MEDIDA_VENTAS, stockActual: Number(stock[0].CANT_STOCK) }
  }

  return { ncompInS, condVta: Number(cli[0].COND_VTA ?? 0), idDireccionEntrega, nroSucursalDestino, articulos }
}

export interface ResultadoRemitoSql {
  yaExistia: boolean
  idSta14: number | null
  ncompInS: string
  nComp: string
}

/**
 * Escribe el remito en Tango. El llamador abre la transacción y pasa un ejecutor
 * atado a ella (así el UPDATE de stock y los INSERT quedan juntos o no queda nada).
 */
export async function escribirRemito(db: EjecutorSql, r: RemitoTango, cfg: ConfigRemitoSql, log: (m: string) => void = () => undefined): Promise<ResultadoRemitoSql> {
  const existe = await db.query<{ ID_STA14: number; NCOMP_IN_S: string }>(sentenciaExiste(r).sql, sentenciaExiste(r).params)
  if (existe.length) {
    log(`remito ${r.nComp} ya estaba en Tango (ID_STA14 ${existe[0].ID_STA14}); no se reescribe`)
    return { yaExistia: true, idSta14: existe[0].ID_STA14, ncompInS: existe[0].NCOMP_IN_S, nComp: r.nComp }
  }
  const datos = await leerDatosRemito(db, r)
  let idSta14: number | null = null
  for (const s of sentenciasRemito(r, datos, cfg)) {
    const filas = await db.query<{ ID?: number; affected?: number }>(s.sql, s.params)
    log(s.etiqueta)
    if (s.etiqueta === 'INSERT STA14' && filas[0]?.ID != null) idSta14 = Number(filas[0].ID)
    if (s.etiqueta.startsWith('UPDATE STA19') && filas[0]?.affected === 0) {
      throw new Error(`${s.etiqueta}: el stock cambió mientras se grababa el remito; se reintenta`)
    }
  }
  return { yaExistia: false, idSta14, ncompInS: datos.ncompInS, nComp: r.nComp }
}

/** Para los tests y el log: lista compacta de lo que se va a ejecutar. */
export function resumenSentencias(ss: SentenciaSql[]): string[] {
  return ss.map((s) => `${s.etiqueta} (${s.params.length} params)`)
}

export type { ParametroSql }
