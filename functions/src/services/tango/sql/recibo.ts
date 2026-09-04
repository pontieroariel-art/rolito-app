// Recibo de cobranza directo en la base de Tango, copiando lo que hace la pantalla
// "Cobranzas" (Ventas → Cuentas Corrientes) — relevado con Extended Events el
// 2026-09-04 (docs/tango/sql/traza-recibo-2026-09-04.txt; INTEGRACION.md §21.2).
//
// Qué escribe Tango al grabar un recibo (y qué hacen sus triggers solos):
//   Cuenta corriente
//   1. INSERT GVA12   el recibo (T_COMP 'REC', TCOMP_IN_V 'RC', ESTADO 'IMP'). Con
//      NCOMP_IN_V en 0 un trigger lo pone = ID_GVA12.
//   2. INSERT gva07   una imputación por factura (T_COMP/N_COMP = la factura,
//      T_COMP_CAN/N_COMP_CAN = el recibo). Los triggers de gva07 recalculan solos los
//      estados de la factura y del recibo (CTA/IMP/PAG/CAN) y los vencimientos (GVA46).
//   3. INSERT HISTORIAL_CUENTAS_CORRIENTES  el rastro de la imputación (ORIGEN 'Cobranzas').
//   4. UPDATE GVA14   saldo del cliente: SALDO_CC y SALDO_CC_U bajan el importe (optimista).
//   Tesorería
//   5. INSERT SBA04   cabecera del movimiento (COD_COMP 'REC', N_INTERNO del contador
//      dbo.INCREMENTAL_VALUE, ID_SBA02 = tipo REC).
//   6. INSERT SBA05   renglón 0 = contracuenta (deudores, 'H'); renglones 1..n = medios
//      (caja/banco, 'D'). Triggers completan ID_SBA01 / ID_SBA04.
//   7. INSERT COMPROBANTE_COTIZACION_SB   cotización del comprobante (pesos, 1.0).
//   8. UPDATE SBA01   saldos de cada cuenta: 'D' suma, 'H' resta (optimista).
//   9. INSERT ASIENTO_COMPROBANTE_SB + ASIENTO_SB  el asiento contable del movimiento
//      (una línea por cuenta, con la cuenta CONTABLE mapeada desde la de tesorería).
//   No se replica: UPDATE GVA43 PROXIMO (codificado → talonario exclusivo de la app),
//   UPDATE GVA16 COTIZ (no-op en pesos), INSERT gva12ty (imagen para reimprimir).
//
// Ids explícitos (HISTORIAL_CUENTAS_CORRIENTES, COMPROBANTE_COTIZACION_SB, ASIENTO_*):
// Tango los manda él. Si la columna es IDENTITY se omite; si no, el ejecutor los
// reserva (INCREMENTAL_VALUE o MAX+1) antes de armar las sentencias — ver `IdsRecibo`.
// Se decide con la consulta (a) de §21.3.
//
// Alcance v1: medios efectivo y transferencia (cuentas de tesorería por config).
// Cheques y retenciones → error explícito hasta relevar sus tablas (SBA20/valores).

import {
  type EjecutorSql, type SentenciaSql,
  varchar, numeric, datetime, bit, int, smallint, float,
  soloDia, horaHHMMSS, numeroComprobanteTango, insert,
} from './tipos'

export interface ConfigReciboSql {
  /** Talonario de recibos EXCLUSIVO de la app en Tango (REC, letra X) y su punto de venta. */
  talonario: number
  puntoVenta: number
  /** Vendedor que queda en el recibo (GVA12.COD_VENDED). */
  codVendedor: string
  concepto: string                      // 'COBRANZAS POR VENTAS'
  /** Cuentas de tesorería: contracuenta (deudores) y por medio de pago. */
  cuentas: { contracuenta: number; efectivo: number; transferencia?: number }
  /** Cuenta CONTABLE (ASIENTO_SB.ID_CUENTA) por cuenta de tesorería — consulta (d) §21.3. */
  cuentasContables: Record<string, number>
  /** SBA02.ID_SBA02 del tipo de comprobante REC en Tesorería (11 en TestingRH — consulta (e)). */
  idSba02Recibo: number
  usuario: string
  terminal: string
}

export interface ImputacionTango {
  tComp: string          // 'FAC'
  nComp: string          // 'A0010100268582'
  importe: number        // lo que se imputa en este recibo
}

export interface MedioTango {
  cuenta: number         // COD_CTA de tesorería (caja / banco)
  importe: number
}

export interface ReciboTango {
  numero: number
  puntoVenta: number
  nComp: string                  // 'X0110600000001'
  codCliente: string
  fecha: Date
  importe: number
  imputaciones: ImputacionTango[]
  medios: MedioTango[]
  leyenda: string                // ROLITO:<cobranzaId>
}

/** Payload de la cobranza tal como lo encola onCobranzaCreada (tango-outbox, entidad 'recibo'). */
export interface PayloadCobranza {
  numeroRecibo?: string           // 'RS-000123'
  clienteCodigoTango?: string | null
  importe?: number
  fecha?: unknown
  imputaciones?: { comprobanteTipo: string; comprobanteNumero: string; importeImputado: number }[]
  medios?: { efectivo?: number; transferencia?: number; cheques?: unknown[]; retenciones?: unknown[] }
  referenciaIdempotente?: string
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function reciboDeCobranza(p: PayloadCobranza, cobranzaId: string, cfg: ConfigReciboSql): ReciboTango {
  if (!p.clienteCodigoTango) throw new Error('la cobranza no tiene clienteCodigoTango')
  const numero = Number(String(p.numeroRecibo ?? '').replace(/\D/g, ''))
  if (!numero) throw new Error(`numeroRecibo inválido: ${p.numeroRecibo}`)
  const imputaciones = (p.imputaciones ?? []).filter((i) => Number(i.importeImputado) > 0).map((i) => ({ tComp: i.comprobanteTipo, nComp: i.comprobanteNumero, importe: r2(Number(i.importeImputado)) }))
  if (!imputaciones.length) throw new Error('la cobranza no imputa ninguna factura')
  const medios: MedioTango[] = []
  const m = p.medios ?? {}
  if (Number(m.efectivo) > 0) medios.push({ cuenta: cfg.cuentas.efectivo, importe: r2(Number(m.efectivo)) })
  if (Number(m.transferencia) > 0) {
    if (!cfg.cuentas.transferencia) throw new Error('cobranza por transferencia sin cuenta de tesorería configurada (config/tango.sql.recibo.cuentas.transferencia)')
    medios.push({ cuenta: cfg.cuentas.transferencia, importe: r2(Number(m.transferencia)) })
  }
  if ((m.cheques?.length ?? 0) > 0 || (m.retenciones?.length ?? 0) > 0) throw new Error('cheques y retenciones todavía no se escriben en Tango por SQL (pendiente de relevar)')
  const importe = r2(Number(p.importe ?? 0))
  const sumImp = r2(imputaciones.reduce((s, i) => s + i.importe, 0))
  const sumMed = r2(medios.reduce((s, x) => s + x.importe, 0))
  if (sumImp !== importe || sumMed !== importe) throw new Error(`el recibo no cierra: importe ${importe}, imputado ${sumImp}, medios ${sumMed}`)
  return {
    numero, puntoVenta: cfg.puntoVenta,
    nComp: numeroComprobanteTango('X', cfg.puntoVenta, numero),
    codCliente: p.clienteCodigoTango, fecha: fechaDe(p.fecha), importe, imputaciones, medios,
    leyenda: p.referenciaIdempotente ?? `ROLITO:${cobranzaId}`,
  }
}

function fechaDe(f: unknown): Date {
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

/** Ids que Tango manda explícitos. null = la columna es IDENTITY y no se pasa. */
export interface IdsRecibo {
  historial: (number | null)[]           // uno por imputación
  cotizacion: number | null
  asientoComprobante: number | null
  asientoRenglones: (number | null)[]    // uno por renglón de tesorería
}

export interface DatosRecibo {
  cliente: { idGva14: number; saldoCc: number; saldoDoc: number; saldoDUn: number; saldoCcU: number }
  /** Por factura imputada: id, importe original y vencimiento (para gva07 / historial). */
  facturas: Record<string, { idGva12: number; importe: number; unidades: number; fechaVto: Date }>
  /** Por cuenta de tesorería: id y saldos actuales (para el UPDATE optimista de SBA01). */
  cuentas: Record<string, { idSba01: number; saldoAMo: number; saldoAUn: number; saldoAct: number }>
  nInternoSba04: number
  ids: IdsRecibo
}

const clave = (i: ImputacionTango) => `${i.tComp}|${i.nComp}`

export function sentenciaExisteRecibo(r: ReciboTango): SentenciaSql {
  return { etiqueta: 'SELECT GVA12 existe', sql: `SELECT ID_GVA12 FROM GVA12 WHERE T_COMP = 'REC' AND N_COMP = @N_COMP`, params: [varchar('N_COMP', r.nComp, 14)] }
}

/** Sentencias del recibo, en el orden de Tango. Puras. El ID del recibo (GVA12) se
 *  obtiene al ejecutar el primer INSERT; las que lo necesitan usan el marcador
 *  `@ID_RECIBO`, que el ejecutor resuelve (ver escribirRecibo). */
export function sentenciasRecibo(r: ReciboTango, d: DatosRecibo, cfg: ConfigReciboSql, ahora = new Date()): SentenciaSql[] {
  const fecha = soloDia(r.fecha)
  const hoy = soloDia(ahora)
  const hora = horaHHMMSS(ahora)
  const term = cfg.terminal.slice(0, 12)
  const usr = cfg.usuario.slice(0, 10)
  const out: SentenciaSql[] = []

  // 1. GVA12 — 39 columnas, mismos valores que la traza. NCOMP_IN_V 0 → trigger = ID_GVA12.
  out.push(insert('INSERT GVA12', 'GVA12', [
    smallint('CANT_HOJAS', 1),
    varchar('CENT_STK', 'N', 1),
    varchar('CENT_COB', 'N', 1),
    varchar('COD_CLIENT', r.codCliente, 6),
    varchar('COD_VENDED', cfg.codVendedor, 10),
    bit('CONTFISCAL', false),
    numeric('COTIZ', 1),
    varchar('ESTADO', 'IMP', 3),
    datetime('FECHA_EMIS', fecha),
    numeric('IMPORTE', r.importe),
    bit('MON_CTE', true),
    varchar('N_COMP', r.nComp, 14),
    numeric('PROPINA', 0),
    numeric('PROPINA_EX', 0),
    smallint('TALONARIO', cfg.talonario),
    varchar('TCOMP_IN_V', 'RC', 2),
    varchar('TIPO_VEND', 'V', 1),
    varchar('T_COMP', 'REC', 3),
    numeric('UNIDADES', r.importe),
    varchar('ESTADO_UNI', 'IMP', 3),
    varchar('HORA_COMP', hora, 6),
    varchar('AFEC_CIERR', 'N', 1),
    bit('REBAJA_DEB', true),
    float('NCOMP_IN_V', 0),
    varchar('GENERA_ASIENTO', 'N', 1),
    datetime('FECHA_INGRESO', hoy),
    varchar('HORA_INGRESO', hora, 6),
    varchar('USUARIO_INGRESO', usr, 120),
    varchar('TERMINAL_INGRESO', term, 255),
    { nombre: 'OBS_COMERC', tipo: { kind: 'text' }, valor: null },
    { nombre: 'OBSERVAC', tipo: { kind: 'text' }, valor: null },
    varchar('LEYENDA_1', r.leyenda.slice(0, 60), 60),
    varchar('LEYENDA_2', null, 60),
    varchar('LEYENDA_3', null, 60),
    varchar('LEYENDA_4', null, 60),
    varchar('LEYENDA_5', null, 60),
    { nombre: 'FECHA_DESCARGA_PDF', tipo: { kind: 'datetime' }, valor: null },
    { nombre: 'HORA_DESCARGA_PDF', tipo: { kind: 'datetime' }, valor: null },
    varchar('USUARIO_DESCARGA_PDF', null, 120),
  ], true))

  // 2 y 3. Por factura: imputación + historial.
  r.imputaciones.forEach((imp, i) => {
    const f = d.facturas[clave(imp)]
    if (!f) throw new Error(`falta leer la factura ${imp.tComp} ${imp.nComp} de Tango`)
    const comunes = [
      datetime('FECHA_VTO', f.fechaVto),
      datetime('F_COMP_CAN', fecha),
      numeric('IMPORTE_VT', f.importe),
      numeric('IMPORT_CAN', imp.importe),
      bit('MISMO_CLIE', true),
      varchar('N_COMP', imp.nComp, 14),
      varchar('N_COMP_CAN', r.nComp, 14),
      varchar('T_COMP', imp.tComp, 3),
      varchar('T_COMP_CAN', 'REC', 3),
      numeric('IMP_CAN_UN', imp.importe),
      numeric('IMP_VT_UNI', f.unidades),
      int('ID_GVA12_CAN', -1),   // marcador: se reemplaza por el ID del recibo al ejecutar
    ]
    out.push(marcarIdRecibo(insert(`INSERT gva07 ${imp.nComp}`, 'gva07', comunes, true)))
    const idHist = d.ids.historial[i]
    out.push(marcarIdRecibo(insert(`INSERT HISTORIAL_CUENTAS_CORRIENTES ${imp.nComp}`, 'HISTORIAL_CUENTAS_CORRIENTES', [
      ...(idHist != null ? [int('ID_HISTORIAL_CUENTAS_CORRIENTES', idHist)] : []),
      ...comunes,
      varchar('ORIGEN', 'Cobranzas', 100),
      varchar('OPERACION', 'A', 1),
      datetime('FECHA', ahora),
      varchar('USUARIO', usr, 120),
      varchar('TERMINAL', term, 255),
      { nombre: 'MOTIVO', tipo: { kind: 'text' }, valor: '' },
      varchar('ESTADO', '', 3),
      varchar('ESTADO_UNI', '', 3),
      numeric('SALDO', 0),
      numeric('SALDO_UNI', 0),
    ])))
  })

  // 4. Saldo del cliente (optimista).
  out.push({
    etiqueta: 'UPDATE GVA14 saldo',
    sql: `UPDATE "GVA14" SET "SALDO_CC"=@SALDO_CC,"SALDO_DOC"=@SALDO_DOC,"SALDO_D_UN"=@SALDO_D_UN,"SALDO_CC_U"=@SALDO_CC_U WHERE "ID_GVA14"=@ID_GVA14 AND "SALDO_CC"=@ANT_CC AND "SALDO_DOC"=@ANT_DOC AND "SALDO_D_UN"=@ANT_D_UN AND "SALDO_CC_U"=@ANT_CC_U`,
    params: [
      numeric('SALDO_CC', r2(d.cliente.saldoCc - r.importe)), numeric('SALDO_DOC', d.cliente.saldoDoc),
      numeric('SALDO_D_UN', d.cliente.saldoDUn), numeric('SALDO_CC_U', r2(d.cliente.saldoCcU - r.importe)),
      int('ID_GVA14', d.cliente.idGva14),
      numeric('ANT_CC', d.cliente.saldoCc), numeric('ANT_DOC', d.cliente.saldoDoc), numeric('ANT_D_UN', d.cliente.saldoDUn), numeric('ANT_CC_U', d.cliente.saldoCcU),
    ],
  })

  // 5. SBA04 — cabecera de tesorería.
  out.push(insert('INSERT SBA04', 'SBA04', [
    varchar('FILLER', ' ', 20),
    smallint('BARRA', 0),
    bit('CERRADO', false),
    smallint('CLASE', 1),
    varchar('COD_COMP', 'REC', 3),
    varchar('CONCEPTO', cfg.concepto.slice(0, 20), 20),
    numeric('COTIZACION', 1),
    bit('EXPORTADO', false),
    bit('EXTERNO', true),
    datetime('FECHA', fecha),
    datetime('FECHA_ING', hoy),
    varchar('HORA_ING', hora, 6),
    varchar('N_COMP', r.nComp, 14),
    float('N_INTERNO', d.nInternoSba04),
    bit('PASE', false),
    varchar('SITUACION', 'N', 1),
    varchar('TERMINAL', term, 12),
    varchar('USUARIO', usr, 10),
    smallint('BARRA_ORI', 0),
    datetime('FECHA_EMIS', fecha),
    varchar('GENERA_ASIENTO', 'S', 1),
    int('ID_GVA81', null),
    int('ID_SBA02', cfg.idSba02Recibo),
    varchar('COD_GVA14', r.codCliente, 6),
    varchar('COD_CPA01', null, 1),
    int('ID_CODIGO_RELACION', null),
    int('ID_LEGAJO', null),
    varchar('TIPO_COD_RELACIONADO', 'C', 1),
    varchar('CN_ASTOR', 'S', 1),
    numeric('TOTAL_IMPORTE_CTE', r.importe),
    numeric('TOTAL_IMPORTE_EXT', r.importe),
    varchar('TRANSFERENCIA_DEVOLUCION_CUPONES', 'N', 1),
  ], true))

  // 6. SBA05 — renglón 0 contracuenta 'H', luego un renglón 'D' por medio.
  const renglones: { cuenta: number; dh: 'D' | 'H'; importe: number }[] = [
    { cuenta: cfg.cuentas.contracuenta, dh: 'H', importe: r.importe },
    ...r.medios.map((m) => ({ cuenta: m.cuenta, dh: 'D' as const, importe: m.importe })),
  ]
  renglones.forEach((ren, i) => {
    out.push(insert(`INSERT SBA05 ${ren.cuenta} ${ren.dh}`, 'SBA05', [
      smallint('BARRA', 0),
      numeric('CANT_MONE', ren.importe),
      smallint('CLASE', 1),
      varchar('COD_COMP', 'REC', 3),
      float('COD_CTA', ren.cuenta),
      varchar('COD_OPERAC', '', 1),
      numeric('COTIZ_MONE', 1),
      varchar('D_H', ren.dh, 1),
      datetime('FECHA', fecha),
      varchar('LEYENDA', '', 1),
      numeric('MONTO', ren.importe),
      varchar('N_COMP', r.nComp, 14),
      int('RENGLON', i),
      numeric('UNIDADES', ren.importe),
      varchar('VA_DIRECTO', 'N', 1),
      int('ID_SBA02', cfg.idSba02Recibo),
      int('ID_GVA81', null),
      varchar('COMENTARIO', '', 1),
      varchar('COMENTARIO_EFT', '', 1),
      varchar('COD_GVA14', r.codCliente, 6),
      varchar('COD_CPA01', null, 1),
      int('ID_CODIGO_RELACION', null),
      int('ID_LEGAJO', null),
      varchar('TIPO_COD_RELACIONADO', 'C', 1),
      int('ID_SBA11', null),
    ], true))
  })

  // 7. Cotización del comprobante.
  out.push(insert('INSERT COMPROBANTE_COTIZACION_SB', 'COMPROBANTE_COTIZACION_SB', [
    ...(d.ids.cotizacion != null ? [int('ID_COMPROBANTE_COTIZACION_SB', d.ids.cotizacion)] : []),
    int('ID_MONEDA', 2), int('ID_TIPO_COTIZACION', 1), numeric('COTIZACION', 1, 17, 7),
    int('ID_SBA02', cfg.idSba02Recibo), varchar('N_COMP', r.nComp, 14), smallint('BARRA', 0),
  ]))

  // 8. Saldos de las cuentas: 'D' suma, 'H' resta (así se movieron en la traza).
  for (const ren of renglones) {
    const c = d.cuentas[String(ren.cuenta)]
    if (!c) throw new Error(`falta leer la cuenta de tesorería ${ren.cuenta} (SBA01)`)
    const delta = ren.dh === 'D' ? ren.importe : -ren.importe
    out.push({
      etiqueta: `UPDATE SBA01 saldo ${ren.cuenta}`,
      sql: `UPDATE "SBA01" SET "SALDO_A_MO"=@MO,"SALDO_A_UN"=@UN,"SALDO_ACT"=@ACT WHERE "SALDO_A_MO"=@ANT_MO AND "SALDO_A_UN"=@ANT_UN AND "SALDO_ACT"=@ANT_ACT AND "ID_SBA01"=@ID`,
      params: [
        numeric('MO', r2(c.saldoAMo + delta)), numeric('UN', r2(c.saldoAUn + delta)), numeric('ACT', r2(c.saldoAct + delta)),
        numeric('ANT_MO', c.saldoAMo), numeric('ANT_UN', c.saldoAUn), numeric('ANT_ACT', c.saldoAct), int('ID', c.idSba01),
      ],
    })
  }

  // 9. Asiento contable del movimiento de tesorería.
  const idAc = d.ids.asientoComprobante
  out.push(insert('INSERT ASIENTO_COMPROBANTE_SB', 'ASIENTO_COMPROBANTE_SB', [
    ...(idAc != null ? [int('ID_ASIENTO_COMPROBANTE_SB', idAc)] : []),
    float('N_INTERNO', d.nInternoSba04), varchar('ASIENTO_ANULACION', 'N', 1), varchar('CONTABILIZADO', 'S', 1),
    varchar('USUARIO_CONTABILIZACION', usr, 10), datetime('FECHA_CONTABILIZACION', ahora), varchar('TERMINAL_CONTABILIZACION', term, 12),
    varchar('TRANSFERIDO_CN', 'N', 1),
  ], idAc == null))
  renglones.forEach((ren, i) => {
    const idCuenta = cfg.cuentasContables[String(ren.cuenta)]
    if (!idCuenta) throw new Error(`la cuenta de tesorería ${ren.cuenta} no tiene cuenta contable en config/tango.sql.recibo.cuentasContables`)
    const idRen = d.ids.asientoRenglones[i]
    out.push(marcarIdAsiento(insert(`INSERT ASIENTO_SB ${ren.cuenta}`, 'ASIENTO_SB', [
      ...(idRen != null ? [int('ID_ASIENTO_SB', idRen)] : []),
      int('ID_ASIENTO_COMPROBANTE_SB', idAc ?? -1),
      int('NRO_RENGLON_ASIENTO_SB', i + 1), int('ID_CUENTA', idCuenta), varchar('D_H', ren.dh, 1),
      { nombre: 'IMPORTE_RENGLON_BASE_SB', tipo: { kind: 'numeric', precision: 19, scale: 4 }, valor: ren.importe },
      { nombre: 'IMPORTE_RENGLON_ALTER_SB', tipo: { kind: 'numeric', precision: 19, scale: 4 }, valor: ren.importe },
      varchar('EDITA_CUENTA', ren.dh === 'H' ? 'N' : 'S', 1),
    ]), idAc == null))
  })
  return out
}

// Marcadores para ids que recién existen al ejecutar (el del recibo GVA12 y el del
// asiento cuando ASIENTO_COMPROBANTE_SB es IDENTITY). `escribirRecibo` los reemplaza.
export interface SentenciaConMarcador extends SentenciaSql { necesitaIdRecibo?: boolean; necesitaIdAsiento?: boolean }
const marcarIdRecibo = (s: SentenciaSql): SentenciaConMarcador => ({ ...s, necesitaIdRecibo: true })
const marcarIdAsiento = (s: SentenciaSql, si: boolean): SentenciaConMarcador => (si ? { ...s, necesitaIdAsiento: true } : s)

/** Lee de Tango lo que hace falta. Consultas marcadas (*) = hipótesis a confirmar (§21.3). */
export async function leerDatosRecibo(db: EjecutorSql, r: ReciboTango, cfg: ConfigReciboSql, identity: Set<string>): Promise<DatosRecibo> {
  const cli = await db.query<{ ID_GVA14: number; SALDO_CC: number; SALDO_DOC: number; SALDO_D_UN: number; SALDO_CC_U: number }>(
    `SELECT ID_GVA14, SALDO_CC, SALDO_DOC, SALDO_D_UN, SALDO_CC_U FROM GVA14 WHERE COD_GVA14 = @COD`, [varchar('COD', r.codCliente, 6)],
  )
  if (!cli.length) throw new Error(`cliente ${r.codCliente} no existe en Tango`)
  const c = cli[0]

  const facturas: DatosRecibo['facturas'] = {}
  for (const imp of r.imputaciones) {
    const f = await db.query<{ ID_GVA12: number; IMPORTE: number; UNIDADES: number; COD_CLIENT: string }>(
      `SELECT ID_GVA12, IMPORTE, UNIDADES, COD_CLIENT FROM GVA12 WHERE T_COMP = @T AND N_COMP = @N`, [varchar('T', imp.tComp, 3), varchar('N', imp.nComp, 14)],
    )
    if (!f.length) throw new Error(`la factura ${imp.tComp} ${imp.nComp} no existe en Tango`)
    if (f[0].COD_CLIENT.trim() !== r.codCliente) throw new Error(`la factura ${imp.nComp} es del cliente ${f[0].COD_CLIENT}, no de ${r.codCliente}`)
    // (*) vencimiento: el primero pendiente en GVA46; si no hay, la fecha del recibo.
    let fechaVto = soloDia(r.fecha)
    try {
      const v = await db.query<{ FECHA_VTO: Date }>(`SELECT TOP 1 FECHA_VTO FROM GVA46 WHERE T_COMP = @T AND N_COMP = @N ORDER BY CASE WHEN ESTADO_VTO = 'PEN' THEN 0 ELSE 1 END, FECHA_VTO`, [varchar('T', imp.tComp, 3), varchar('N', imp.nComp, 14)])
      if (v.length && v[0].FECHA_VTO) fechaVto = new Date(v[0].FECHA_VTO)
    } catch { /* sin GVA46 → fecha del recibo */ }
    facturas[clave(imp)] = { idGva12: f[0].ID_GVA12, importe: Number(f[0].IMPORTE), unidades: Number(f[0].UNIDADES), fechaVto }
  }

  const cuentas: DatosRecibo['cuentas'] = {}
  for (const cod of [cfg.cuentas.contracuenta, ...r.medios.map((m) => m.cuenta)]) {
    const q = await db.query<{ ID_SBA01: number; SALDO_A_MO: number; SALDO_A_UN: number; SALDO_ACT: number }>(
      `SELECT ID_SBA01, SALDO_A_MO, SALDO_A_UN, SALDO_ACT FROM SBA01 WHERE COD_CTA = @COD`, [float('COD', cod)],
    )
    if (!q.length) throw new Error(`la cuenta de tesorería ${cod} no existe en Tango (SBA01)`)
    cuentas[String(cod)] = { idSba01: q[0].ID_SBA01, saldoAMo: Number(q[0].SALDO_A_MO), saldoAUn: Number(q[0].SALDO_A_UN), saldoAct: Number(q[0].SALDO_ACT) }
  }

  const nInternoSba04 = await siguiente(db, 'SBA04', 'N_INTERNO')
  const ids: IdsRecibo = {
    historial: await Promise.all(r.imputaciones.map(() => identity.has('HISTORIAL_CUENTAS_CORRIENTES') ? null : siguiente(db, 'HISTORIAL_CUENTAS_CORRIENTES', 'ID_HISTORIAL_CUENTAS_CORRIENTES'))),
    cotizacion: identity.has('COMPROBANTE_COTIZACION_SB') ? null : await siguiente(db, 'COMPROBANTE_COTIZACION_SB', 'ID_COMPROBANTE_COTIZACION_SB'),
    asientoComprobante: identity.has('ASIENTO_COMPROBANTE_SB') ? null : await siguiente(db, 'ASIENTO_COMPROBANTE_SB', 'ID_ASIENTO_COMPROBANTE_SB'),
    asientoRenglones: [],
  }
  const nRenglones = 1 + r.medios.length
  for (let i = 0; i < nRenglones; i++) ids.asientoRenglones.push(identity.has('ASIENTO_SB') ? null : await siguiente(db, 'ASIENTO_SB', 'ID_ASIENTO_SB'))

  return { cliente: { idGva14: c.ID_GVA14, saldoCc: Number(c.SALDO_CC), saldoDoc: Number(c.SALDO_DOC), saldoDUn: Number(c.SALDO_D_UN), saldoCcU: Number(c.SALDO_CC_U) }, facturas, cuentas, nInternoSba04, ids }
}

/** Próximo valor de un contador de Tango: dbo.INCREMENTAL_VALUE (como hace Tango con SBA04.N_INTERNO), si no MAX+1. */
async function siguiente(db: EjecutorSql, tabla: string, campo: string): Promise<number> {
  const inc = await db.query<{ UltimoValor: number }>(`SELECT UltimoValor FROM dbo.INCREMENTAL_VALUE WHERE Tabla = @T AND Campo = @C`, [varchar('T', tabla, 50), varchar('C', campo, 50)]).catch(() => [] as { UltimoValor: number }[])
  if (inc.length) {
    const ultimo = Number(inc[0].UltimoValor), sig = ultimo + 1
    const upd = await db.query<{ affected?: number }>(`UPDATE dbo.INCREMENTAL_VALUE SET UltimoValor = @V WHERE Tabla = @T AND Campo = @C AND UltimoValor = @ANT`, [int('V', sig), varchar('T', tabla, 50), varchar('C', campo, 50), int('ANT', ultimo)])
    if (upd[0]?.affected === 0) throw new Error(`contador ${tabla}.${campo} cambió mientras se reservaba; se reintenta`)
    return sig
  }
  const mx = await db.query<{ M: number | null }>(`SELECT MAX(${campo}) AS M FROM ${tabla}`)
  return (Number(mx[0]?.M ?? 0) || 0) + 1
}

/** Columnas IDENTITY de las tablas del recibo (consulta (a) §21.3), para no mandar ids explícitos donde SQL Server los asigna. */
export async function tablasConIdentity(db: EjecutorSql): Promise<Set<string>> {
  const rows = await db.query<{ tabla: string }>(`SELECT OBJECT_NAME(object_id) AS tabla FROM sys.identity_columns WHERE OBJECT_NAME(object_id) IN ('GVA12','GVA07','HISTORIAL_CUENTAS_CORRIENTES','SBA04','SBA05','COMPROBANTE_COTIZACION_SB','ASIENTO_COMPROBANTE_SB','ASIENTO_SB')`)
  return new Set(rows.map((x) => x.tabla.toUpperCase()))
}

export interface ResultadoReciboSql { yaExistia: boolean; idGva12: number | null; nComp: string; nInternoSba04: number | null }

export async function escribirRecibo(db: EjecutorSql, r: ReciboTango, cfg: ConfigReciboSql, log: (m: string) => void = () => undefined): Promise<ResultadoReciboSql> {
  const ex = sentenciaExisteRecibo(r)
  const existe = await db.query<{ ID_GVA12: number }>(ex.sql, ex.params)
  if (existe.length) {
    log(`recibo ${r.nComp} ya estaba en Tango (ID_GVA12 ${existe[0].ID_GVA12}); no se reescribe`)
    return { yaExistia: true, idGva12: existe[0].ID_GVA12, nComp: r.nComp, nInternoSba04: null }
  }
  const identity = await tablasConIdentity(db)
  const datos = await leerDatosRecibo(db, r, cfg, identity)
  let idGva12: number | null = null
  let idAsiento: number | null = datos.ids.asientoComprobante
  for (const s of sentenciasRecibo(r, datos, cfg) as SentenciaConMarcador[]) {
    const params = s.params.map((p) => {
      if (s.necesitaIdRecibo && p.nombre === 'ID_GVA12_CAN') return { ...p, valor: idGva12 }
      if (s.necesitaIdAsiento && p.nombre === 'ID_ASIENTO_COMPROBANTE_SB') return { ...p, valor: idAsiento }
      return p
    })
    if (s.necesitaIdRecibo && idGva12 == null) throw new Error('no se obtuvo el ID_GVA12 del recibo')
    const filas = await db.query<{ ID?: number; affected?: number }>(s.sql, params)
    log(s.etiqueta)
    if (s.etiqueta === 'INSERT GVA12' && filas[0]?.ID != null) idGva12 = Number(filas[0].ID)
    if (s.etiqueta === 'INSERT ASIENTO_COMPROBANTE_SB' && idAsiento == null && filas[0]?.ID != null) idAsiento = Number(filas[0].ID)
    if (s.etiqueta.startsWith('UPDATE') && filas[0]?.affected === 0) throw new Error(`${s.etiqueta}: el saldo cambió mientras se grababa el recibo; se reintenta`)
  }
  return { yaExistia: false, idGva12, nComp: r.nComp, nInternoSba04: datos.nInternoSba04 }
}
