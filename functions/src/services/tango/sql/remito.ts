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
//
// La cabecera, el renglón y el update de stock se arman en comun.ts, compartidos
// con el writer de movimientos de stock (movimientoStock.ts).

import type { PayloadVenta } from '../pedido'
import { type EjecutorSql, type SentenciaSql, type ParametroSql, varchar, int, numeroComprobanteTango } from './tipos'
import {
  fechaDePayload, renglonesDeItems, siguienteNcompInS, cabeceraSta14, renglonSta20, updateSta19,
  leerArticulo, leerStock, type RenglonStock,
} from './comun'

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

export type RenglonRemito = RenglonStock

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
  const renglones = renglonesDeItems([payload.items, payload.cambios], articulos)
  if (renglones.length === 0) throw new Error('remito sin renglones')
  return {
    numero: ci.numero,
    puntoVenta: pv,
    nComp: numeroComprobanteTango('R', pv, ci.numero),
    codCliente: payload.clienteCodigoTango,
    codDeposito,
    fecha: fechaDePayload(payload.fecha),
    renglones,
    observacion: `ROLITO:VC:${origenId}`,
  }
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
  const out: SentenciaSql[] = []

  // 1. Cabecera — mismas 60 columnas y valores que la traza.
  out.push(cabeceraSta14({
    tComp: 'REM', tcompInS: 'RE', talonario: cfg.talonario,
    nComp: r.nComp, nRemito: r.nComp, ncompInS: datos.ncompInS,
    codCliente: r.codCliente, codDeposito: r.codDeposito,
    estadoMov: 'P', motivoRem: 'V', codTransp: cfg.codigoTransporte,
    fecha: r.fecha, ahora, usuario: cfg.usuario, terminal: cfg.terminal,
    // La referencia idempotente va en LEYENDA1 (varchar 60): se lee desde Tango y
    // sirve para cruzar contra ventasCamion sin depender solo del número.
    leyendas: [r.observacion],
    idDireccionEntrega: datos.idDireccionEntrega, nroSucursalDestino: datos.nroSucursalDestino, condVta: datos.condVta,
  }))

  // 2. Renglones: salida del depósito, cantidad y pendiente de facturar iguales.
  r.renglones.forEach((ren, i) => {
    const art = datos.articulos[ren.codArticu]
    if (!art) throw new Error(`falta leer el artículo ${ren.codArticu} de Tango (unidades / stock)`)
    out.push(renglonSta20({
      etiqueta: `INSERT STA20 ${ren.codArticu}`,
      codArticu: ren.codArticu, cantidad: ren.cantidad, tipoMov: 'S', codDeposito: r.codDeposito,
      nRenglon: i + 1, tcompInS: 'RE', ncompInS: datos.ncompInS, fecha: r.fecha,
      idMedidaStock: art.idMedidaStock, idMedidaVentas: art.idMedidaVentas,
      cantPendiente: ren.cantidad,
      impuestoInternoFijo: 1,   // así lo graba Tango en un remito sin precios
    }))
  })

  // 3. Stock del depósito, con la misma concurrencia optimista de Tango.
  for (const ren of r.renglones) {
    const art = datos.articulos[ren.codArticu]!
    out.push(updateSta19(`UPDATE STA19 stock ${ren.codArticu}`, ren.codArticu, r.codDeposito, art.stockActual, -ren.cantidad))
  }
  return out
}

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

  // Dirección de entrega habitual del cliente (STA14.ID_DIRECCION_ENTREGA; 8470 en
  // la traza). Tango la exige al facturar desde el remito: sin ella tira "No hay
  // un domicilio de entrega con el id: 0" (2026-09-08). La tabla NO tiene
  // NRO_SUCURSAL (la consulta anterior lo pedía, fallaba y el catch dejaba NULL
  // en TODOS los remitos): se lee solo el id, y si el cliente no tiene ninguna
  // dirección cargada el remito no se escribe, para que el error se vea en la cola.
  const dir = await db.query<{ ID_DIRECCION_ENTREGA: number }>(
    `SELECT TOP 1 ID_DIRECCION_ENTREGA FROM DIRECCION_ENTREGA WHERE ID_GVA14 = @ID ORDER BY CASE WHEN HABITUAL = 'S' THEN 0 ELSE 1 END, ID_DIRECCION_ENTREGA`,
    [int('ID', cli[0].ID_GVA14)],
  )
  if (!dir.length) throw new Error(`el cliente ${r.codCliente} no tiene dirección de entrega cargada en Tango (DIRECCION_ENTREGA): cargarla en la ficha y reintentar`)
  const idDireccionEntrega = dir[0].ID_DIRECCION_ENTREGA
  const nroSucursalDestino = 0

  const ncompInS = await siguienteNcompInS(db, 'RE')

  // Artículos: unidades de medida y stock actual en el depósito.
  const articulos: DatosRemito['articulos'] = {}
  for (const ren of r.renglones) {
    const art = await leerArticulo(db, ren.codArticu)
    const stockActual = await leerStock(db, ren.codArticu, r.codDeposito)
    if (stockActual === null) throw new Error(`el artículo ${ren.codArticu} no tiene saldo de stock en el depósito ${r.codDeposito} (STA19)`)
    articulos[ren.codArticu] = { ...art, stockActual }
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
