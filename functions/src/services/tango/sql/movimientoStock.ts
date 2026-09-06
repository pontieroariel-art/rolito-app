// Movimientos de STOCK directo en la base de Tango (STA14 / STA20 / STA19 / STA17):
// un writer único para el EGRESO por venta promo (tipo VPR, hoy) y para las
// TRANSFERENCIAS entre depósitos de la carga, la descarga y los cambios (fase B).
//
// Por qué existe (decisión de Ariel 2026-09-05, docs/tango/STOCK_REPARTO.md): TODO
// el stock del reparto vive en la empresa REDONHIELO. La venta promo se factura en
// Rolito pero la mercadería sale del camión de Redonhielo, así que por cada venta
// promo se graba acá un egreso puro de stock desde el depósito del camión; la
// factura de Rolito no descarga stock (config/tango.facturador.rolito.descargaStock).
//
// Qué escribe, en orden (copiado de las muestras reales de CAR/DES/CBS en
// docs/tango/sql/muestras-stock-2026-09-04.json y de la traza del remito):
//   1. UPDATE STA17  toma el próximo número del talonario de stock (PROXIMO es un
//      número plano) con concurrencia optimista: si la oficina numeró en el medio,
//      afecta 0 filas y se reintenta. Va PRIMERO para no insertar con número usado.
//   2. INSERT STA14  cabecera: T_COMP del tipo (VPR/CAR/DES), TCOMP_IN_S interno,
//      N_COMP = sucursal del talonario (5) + número (8), LEYENDA1 = referencia
//      idempotente. Triggers de Tango completan ID_STA13 e ID_GVA14.
//   3. INSERT STA20  egreso: un renglón 'S' por artículo desde el depósito origen;
//      transferencia: dos por artículo, 'E' en destino (DEPOSI_DDE = origen) y 'S'
//      en origen (DEPOSI_DDE = destino), como graba Tango.
//   4. UPDATE STA19  saldo del depósito origen (−), y del destino (+) en la
//      transferencia, optimista.
//
// Idempotencia: se busca STA14 por T_COMP + LEYENDA1 (la referencia 'ROLITO:VC:<id>');
// si existe, se devuelve sin escribir.
//
// Confirmado con la traza XE del 2026-09-05 (docs/tango/sql/traza-stock-2026-09-05.csv:
// egreso VPR 00900-00000001 y transferencia TRA 00025-00067900 en TestingRH):
//   - TCOMP_IN_S del egreso = 'VS'; NCOMP_IN_S = MAX + 1 dentro del tipo interno
//     (no usa INCREMENTAL_VALUE). Transferencia: 'TI'.
//   - N_COMP = ' ' + sucursal (5) + número (8), 14 caracteres con espacio adelante.
//   - Cabecera SIN depósito (COD_DEPOSI '') y sin cliente; ESTADO_MOV/MOTIVO_REM/
//     N_REMITO/COD_TRANSP ''; ID_DIRECCION_ENTREGA NULL; HORA/USUARIO/TERMINAL_ANU NULL;
//     OBSERVACIO = observaciones de la pantalla; LEYENDA1..5 = las 5 leyendas.
//   - Renglón: CANT_PEND 0, IMPUESTO_INTERNO_FIJO 0, ID_MEDIDA_VENTAS NULL, DEPOSI_DDE
//     '' en el egreso; en la transferencia 'E' en destino (DEPOSI_DDE = origen) y 'S'
//     en origen (DEPOSI_DDE = destino).
//   - STA19: UPDATE optimista (WHERE con el CANT_STOCK leído). STA17: UPDATE de PROXIMO
//     optimista (Tango lo hace al final; acá va primero, da lo mismo dentro de la
//     transacción). Ninguna otra tabla (no hay STA14TY ni auditoría).
// Lo que sigue en TRAZA son esos valores; quedan como constantes por si otra
// versión de Tango los cambia.

// OJO: esta carpeta (sql/) se copia sola al servidor de Tango; solo importar en
// runtime desde ./tipos y ./comun (de ../pedido únicamente tipos).
import type { PayloadVenta, ItemVenta } from '../pedido'
import { type EjecutorSql, type SentenciaSql, varchar, int, smallint } from './tipos'
import {
  fechaDePayload, renglonesDeItems, siguienteNcompInS, numeroComprobanteStock, referenciaVenta, numeroInternoDe,
  cabeceraSta14, renglonSta20, updateSta19, leerArticulo, leerStock, type RenglonStock,
} from './comun'

/** Valores confirmados por la traza del 2026-09-05. Los tests los importan. */
export const TRAZA = {
  /** TCOMP_IN_S del egreso de stock si la config no lo trae ('TI' = transferencia, 'RE' = remito, 'VE' = CBS). */
  tcompInSEgreso: 'VS',
  /** Dígitos de la sucursal en N_COMP: 5 en lo que graba Tango, 4 en lo que grababa Bluesoft. */
  anchoSucursal: 5,
  cantPend: 0,
  impuestoInternoFijo: 0,
  /** Ni el egreso ni la transferencia llevan depósito en la cabecera: va por renglón. */
  codDepositoEnCabeceraEgreso: false,
} as const
/** @deprecated nombre viejo, hasta que la traza se documente en INTEGRACION.md §24. */
export const HIPOTESIS_TRAZA = TRAZA

export type TipoMovimientoStock = 'egreso' | 'transferencia'

/** config/tango.sql.stock.tipos.<clave> — un tipo de comprobante de stock de Tango. */
export interface ConfigTipoMovimiento {
  tipo: TipoMovimientoStock
  /** STA13.T_COMP: 'VPR' (venta promo app), 'CAR', 'DES'… Tiene que existir en la base destino. */
  tComp: string
  /** STA14.TCOMP_IN_S del tipo interno: 'VS' egreso, 'TI' transferencia (traza 2026-09-05). */
  tcompInS?: string
  /** CÓDIGO del talonario de stock (STA17.TALONARIO = STA13.TALONARIO = STA14.TALONARIO; en TestingRH el 900 tiene ID_STA17 14 — el código es el que vincula). */
  talonario: number
  /** Sucursal del talonario (STA17.SUCURSAL). Si falta se lee de STA17. */
  sucursal?: number
  anchoSucursal?: number
  /** Egreso por venta: si los cambios (bolsas repuestas) salen también. true hasta la fase B(c). */
  incluyeCambios?: boolean
  /** Transferencia con destino fijo (ej. cambios → 99 MERMAS). */
  depositoDestino?: string
}

/** config/tango.sql.stock */
export interface ConfigStockSql {
  usuario: string
  terminal: string
  tipos: Record<string, ConfigTipoMovimiento>
}

export interface MovimientoStockTango {
  /** Clave del tipo en config (ventaPromo, carga, descarga…). Solo informativa. */
  clave: string
  tipo: TipoMovimientoStock
  tComp: string
  tcompInS: string
  talonario: number
  anchoSucursal: number
  depositoOrigen: string
  depositoDestino?: string
  fecha: Date
  renglones: RenglonStock[]
  /** LEYENDA1: referencia idempotente ('ROLITO:VC:<id>'). */
  referencia: string
  /** LEYENDA2..5 */
  leyendas: string[]
  codCliente?: string
  observacion?: string
}

export interface DatosMovimiento {
  ncompInS: string
  /** Número tomado del talonario y el PROXIMO leído (para el UPDATE optimista). */
  numero: number
  proximoLeido: number
  sucursal: number
  nComp: string
  articulos: Record<string, { idMedidaStock: number; idMedidaVentas: number | null; stockOrigen: number; stockDestino: number | null }>
}

export interface ResultadoMovimientoSql {
  yaExistia: boolean
  idSta14: number | null
  nComp: string
  numero: number
  ncompInS: string
  tComp: string
}

// ── Builders puros ───────────────────────────────────────────────────────────

function movimientoBase(cfgTipo: ConfigTipoMovimiento, clave: string): Pick<MovimientoStockTango, 'clave' | 'tipo' | 'tComp' | 'tcompInS' | 'talonario' | 'anchoSucursal'> {
  if (!cfgTipo.tComp || !cfgTipo.talonario) throw new Error(`config/tango.sql.stock.tipos.${clave} incompleto: falta tComp o talonario`)
  const tcompInS = cfgTipo.tcompInS ?? (cfgTipo.tipo === 'transferencia' ? 'TI' : TRAZA.tcompInSEgreso)
  return {
    clave, tipo: cfgTipo.tipo, tComp: cfgTipo.tComp, tcompInS, talonario: cfgTipo.talonario,
    anchoSucursal: cfgTipo.anchoSucursal ?? TRAZA.anchoSucursal,
  }
}

/**
 * Egreso de stock por una venta promo (o cualquier venta cuya mercadería salga
 * del depósito del camión sin que el comprobante de venta la descuente). Los
 * cambios salen también (misma bolsa, sin cargo) mientras no exista el writer
 * de cambios camión → merma (fase B c).
 */
export function egresoDeVentaPromo(
  payload: PayloadVenta,
  origenColeccion: string,
  origenId: string,
  articulos: Record<string, string>,
  codDeposito: string,
  cfgTipo: ConfigTipoMovimiento,
  clave = 'ventaPromo',
): MovimientoStockTango {
  if (cfgTipo.tipo !== 'egreso') throw new Error(`config/tango.sql.stock.tipos.${clave}.tipo tiene que ser 'egreso'`)
  if (!codDeposito) throw new Error('la venta no tiene depósito de Tango')
  const listas: (ItemVenta[] | undefined)[] = [payload.items]
  if (cfgTipo.incluyeCambios !== false) listas.push(payload.cambios)
  const renglones = renglonesDeItems(listas, articulos)
  if (renglones.length === 0) throw new Error('la venta no tiene renglones con cantidad > 0: no hay egreso que grabar')
  const numeroInterno = numeroInternoDe(payload.comprobanteInterno)
  const tipoPapel = payload.comprobanteInterno?.tipo === 'facturaX' ? 'Fact X' : payload.comprobanteInterno?.tipo === 'remitoPromo' ? 'Remito' : 'Venta'
  return {
    ...movimientoBase(cfgTipo, clave),
    depositoOrigen: codDeposito,
    fecha: fechaDePayload(payload.fecha),
    renglones,
    referencia: referenciaVenta(origenColeccion, origenId),
    leyendas: [
      `${tipoPapel} Rolito${numeroInterno ? ` ${numeroInterno}` : ''} - ${payload.formaPago ?? ''}`.trim(),
      `Chofer ${payload.choferNombre ?? payload.choferId ?? ''} - dep ${codDeposito}`,
      `Cliente ${payload.clienteCodigoTango ?? ''} ${payload.clienteNombre ?? ''}`.trim(),
      payload.plantaId ? `Ventanilla ${payload.plantaId}` : '',
    ],
    codCliente: payload.clienteCodigoTango,
  }
}

/** Payload del item `transferenciaDeposito` que encola tangoOutbox.ts (remito de carga / descarga). */
export interface PayloadTransferencia {
  sentido: 'carga' | 'descarga'
  codigo?: string
  numero?: number
  plantaId?: string
  camionId?: string
  camionLabel?: string
  choferId?: string
  choferNombre?: string
  items?: ItemVenta[]
  fecha?: unknown
}

/**
 * Transferencia planta ↔ camión. Carga: planta → camión (CAR). Descarga: camión →
 * planta (DES). Solo la mercadería sana (`items`); las rotas de la descarga van
 * por otro comprobante (fase B). Fase B: el bridge todavía no la despacha.
 */
export function transferenciaDeCargaDescarga(
  payload: PayloadTransferencia,
  origenColeccion: string,
  origenId: string,
  articulos: Record<string, string>,
  depositoPlanta: string,
  depositoCamion: string,
  cfgTipo: ConfigTipoMovimiento,
  clave = payload.sentido,
): MovimientoStockTango {
  if (cfgTipo.tipo !== 'transferencia') throw new Error(`config/tango.sql.stock.tipos.${clave}.tipo tiene que ser 'transferencia'`)
  if (!depositoPlanta || !depositoCamion) throw new Error('falta el depósito de la planta o del camión')
  if (payload.sentido !== 'carga' && payload.sentido !== 'descarga') throw new Error(`sentido desconocido: ${String(payload.sentido)}`)
  const renglones = renglonesDeItems([payload.items], articulos)
  if (renglones.length === 0) throw new Error('la transferencia no tiene renglones con cantidad > 0')
  const carga = payload.sentido === 'carga'
  const prefijo = origenColeccion === 'remitosCarga' ? 'RC' : origenColeccion === 'descargasCamion' ? 'DC' : origenColeccion
  return {
    ...movimientoBase(cfgTipo, clave),
    depositoOrigen: carga ? depositoPlanta : depositoCamion,
    depositoDestino: carga ? depositoCamion : depositoPlanta,
    fecha: fechaDePayload(payload.fecha),
    renglones,
    referencia: `ROLITO:${prefijo}:${origenId}`,
    leyendas: [
      `${carga ? 'Remito de carga' : 'Descarga'} app${payload.codigo ? ` ${payload.codigo}` : ''}`,
      `Chofer ${payload.choferNombre ?? payload.choferId ?? ''} - ${payload.camionLabel ?? payload.camionId ?? ''}`.trim(),
      payload.plantaId ? `Planta ${payload.plantaId}` : '',
    ],
  }
}

// ── Sentencias ───────────────────────────────────────────────────────────────

/** ¿Ya existe este movimiento en Tango? (idempotencia: T_COMP + LEYENDA1 = referencia). */
export function sentenciaExisteMovimiento(m: MovimientoStockTango): SentenciaSql {
  return {
    etiqueta: 'SELECT STA14 existe',
    sql: `SELECT ID_STA14, N_COMP, NCOMP_IN_S FROM STA14 WHERE T_COMP = @T_COMP AND LEYENDA1 = @REF`,
    params: [varchar('T_COMP', m.tComp, 3), varchar('REF', m.referencia.slice(0, 60), 60)],
  }
}

/**
 * Las sentencias de escritura, en orden. Puras: no tocan la base. `datos` viene de
 * leerDatosMovimiento (o del test).
 */
export function sentenciasMovimiento(m: MovimientoStockTango, datos: DatosMovimiento, cfg: { usuario: string; terminal: string }, ahora = new Date()): SentenciaSql[] {
  const out: SentenciaSql[] = []
  const transferencia = m.tipo === 'transferencia'
  if (transferencia && !m.depositoDestino) throw new Error('transferencia sin depósito destino')

  // 1. Número del talonario, optimista.
  out.push({
    etiqueta: 'UPDATE STA17 proximo',
    sql: `UPDATE "STA17" SET "PROXIMO" = @SIGUIENTE WHERE "TALONARIO" = @TALONARIO AND "PROXIMO" = @ANTERIOR`,
    params: [int('SIGUIENTE', datos.numero + 1), smallint('TALONARIO', m.talonario), int('ANTERIOR', datos.proximoLeido)],
  })

  // 2. Cabecera.
  out.push(cabeceraSta14({
    tComp: m.tComp, tcompInS: m.tcompInS, talonario: m.talonario,
    nComp: datos.nComp, ncompInS: datos.ncompInS,
    // Cliente: Tango no lo pide en el egreso, pero la columna existe y los CBS de
    // Bluesoft lo grababan (41.732 comprobantes). Sirve para cruzar en consultas.
    codCliente: m.codCliente,
    codDeposito: !transferencia && TRAZA.codDepositoEnCabeceraEgreso ? m.depositoOrigen : undefined,
    fecha: m.fecha, ahora, usuario: cfg.usuario, terminal: cfg.terminal,
    leyendas: [m.referencia, ...m.leyendas],
    observacion: m.observacion,
    anulacionNull: true,
  }))

  // 3. Renglones.
  let n = 0
  for (const ren of m.renglones) {
    const art = datos.articulos[ren.codArticu]
    if (!art) throw new Error(`falta leer el artículo ${ren.codArticu} de Tango (unidades / stock)`)
    const comun = {
      codArticu: ren.codArticu, cantidad: ren.cantidad, tcompInS: m.tcompInS, ncompInS: datos.ncompInS, fecha: m.fecha,
      // ID_MEDIDA_VENTAS va NULL en los movimientos de stock (traza); solo el remito lo lleva.
      idMedidaStock: art.idMedidaStock, idMedidaVentas: null,
      cantPendiente: TRAZA.cantPend, impuestoInternoFijo: TRAZA.impuestoInternoFijo,
    }
    if (transferencia) {
      // Tango graba primero la ENTRADA en el destino y después la SALIDA del origen (muestra CAR).
      out.push(renglonSta20({ ...comun, etiqueta: `INSERT STA20 ${ren.codArticu} E`, tipoMov: 'E', codDeposito: m.depositoDestino!, depositoDesde: m.depositoOrigen, nRenglon: ++n }))
      out.push(renglonSta20({ ...comun, etiqueta: `INSERT STA20 ${ren.codArticu} S`, tipoMov: 'S', codDeposito: m.depositoOrigen, depositoDesde: m.depositoDestino, nRenglon: ++n }))
    } else {
      out.push(renglonSta20({ ...comun, etiqueta: `INSERT STA20 ${ren.codArticu}`, tipoMov: 'S', codDeposito: m.depositoOrigen, nRenglon: ++n }))
    }
  }

  // 4. Saldos (Tango actualiza primero el destino y después el origen).
  for (const ren of m.renglones) {
    const art = datos.articulos[ren.codArticu]!
    if (transferencia) {
      if (art.stockDestino === null) {
        // La traza no muestra qué hace Tango cuando el destino no tiene fila en STA19
        // (los dos depósitos la tenían). Hasta verlo, error claro: la oficina crea la
        // fila con el inventario inicial (STOCK_REPARTO.md §4.4).
        throw new Error(`el artículo ${ren.codArticu} no tiene fila de stock en el depósito destino ${m.depositoDestino} (STA19)`)
      }
      out.push(updateSta19(`UPDATE STA19 destino ${ren.codArticu}`, ren.codArticu, m.depositoDestino!, art.stockDestino, ren.cantidad))
    }
    out.push(updateSta19(`UPDATE STA19 stock ${ren.codArticu}`, ren.codArticu, m.depositoOrigen, art.stockOrigen, -ren.cantidad))
  }
  return out
}

/** Lee de Tango lo que las sentencias necesitan: talonario, número interno, artículos y saldos. */
export async function leerDatosMovimiento(db: EjecutorSql, m: MovimientoStockTango, sucursalCfg?: number): Promise<DatosMovimiento> {
  const tal = await db.query<{ SUCURSAL: number; PROXIMO: number }>(`SELECT SUCURSAL, PROXIMO FROM STA17 WHERE TALONARIO = @TALONARIO`, [smallint('TALONARIO', m.talonario)])
  if (!tal.length) throw new Error(`el talonario de stock ${m.talonario} (STA17.TALONARIO) no existe en esta base`)
  const proximoLeido = Number(tal[0].PROXIMO)
  const sucursal = sucursalCfg ?? Number(tal[0].SUCURSAL ?? 0)
  const numero = proximoLeido
  const nComp = numeroComprobanteStock(sucursal, numero, m.anchoSucursal)

  const ncompInS = await siguienteNcompInS(db, m.tcompInS, false)

  const articulos: DatosMovimiento['articulos'] = {}
  for (const ren of m.renglones) {
    const art = await leerArticulo(db, ren.codArticu)
    const stockOrigen = await leerStock(db, ren.codArticu, m.depositoOrigen)
    if (stockOrigen === null) throw new Error(`el artículo ${ren.codArticu} no tiene fila de stock en el depósito ${m.depositoOrigen} (STA19) — hace falta el inventario inicial de ese depósito`)
    const stockDestino = m.depositoDestino ? await leerStock(db, ren.codArticu, m.depositoDestino) : null
    articulos[ren.codArticu] = { ...art, stockOrigen, stockDestino }
  }
  return { ncompInS, numero, proximoLeido, sucursal, nComp, articulos }
}

/**
 * Escribe el movimiento en Tango. El llamador abre la transacción y pasa un ejecutor
 * atado a ella. Cualquier UPDATE optimista que afecte 0 filas aborta (se reintenta).
 */
export async function escribirMovimientoStock(
  db: EjecutorSql,
  m: MovimientoStockTango,
  cfg: { usuario: string; terminal: string; sucursal?: number },
  log: (msg: string) => void = () => undefined,
): Promise<ResultadoMovimientoSql> {
  const ex = sentenciaExisteMovimiento(m)
  const existe = await db.query<{ ID_STA14: number; N_COMP: string; NCOMP_IN_S: string }>(ex.sql, ex.params)
  if (existe.length) {
    log(`${m.tComp} ${m.referencia} ya estaba en Tango (${existe[0].N_COMP}, ID_STA14 ${existe[0].ID_STA14}); no se reescribe`)
    return { yaExistia: true, idSta14: existe[0].ID_STA14, nComp: existe[0].N_COMP.trim(), numero: Number(existe[0].N_COMP.slice(-8)) || 0, ncompInS: existe[0].NCOMP_IN_S, tComp: m.tComp }
  }
  const datos = await leerDatosMovimiento(db, m, cfg.sucursal)
  let idSta14: number | null = null
  for (const s of sentenciasMovimiento(m, datos, cfg)) {
    const filas = await db.query<{ ID?: number; affected?: number }>(s.sql, s.params)
    log(s.etiqueta)
    if (s.etiqueta === 'INSERT STA14' && filas[0]?.ID != null) idSta14 = Number(filas[0].ID)
    if (s.etiqueta.startsWith('UPDATE') && filas[0]?.affected === 0) {
      throw new Error(`${s.etiqueta}: ${s.etiqueta.includes('STA17') ? 'el talonario' : 'el stock'} cambió mientras se grababa el movimiento; se reintenta`)
    }
  }
  for (const ren of m.renglones) {
    const art = datos.articulos[ren.codArticu]!
    if (art.stockOrigen - ren.cantidad < 0) log(`aviso: ${ren.codArticu} queda en negativo en el depósito ${m.depositoOrigen} (${art.stockOrigen} - ${ren.cantidad})`)
  }
  return { yaExistia: false, idSta14, nComp: datos.nComp.trim(), numero: datos.numero, ncompInS: datos.ncompInS, tComp: m.tComp }
}
