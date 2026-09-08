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
// Cheques de terceros (relevado el 2026-09-05, docs/tango/sql/traza-recibo-cheque-2026-09-05.txt):
//   el cheque es un medio más: un renglón SBA05 'D' sobre la cuenta de cartera (VALORES A
//   DEPOSITAR 1112000; e-cheq 1112002) con la SUMA de los cheques de esa cuenta, y por cada
//   cheque: INSERT SBA14 (el cheque en cartera: ESTADO 'C', TIPO_CHEQU 'D'/'C', fechas, banco,
//   CUIT y razón social del librador — triggers completan ID_GVA14/ID_CPA01), INSERT SBA23
//   (historial del cheque, estado 'C') e INSERT MOVIMIENTO_CHEQUE_TERCERO (ID_SBA14 ↔ ID_SBA05
//   del renglón de cartera, 'INGR'). El asiento lleva la cuenta contable de la cartera (602).
//   SBA90 (grilla temporal de la pantalla) no se replica. SBA14.N_INTERNO sale de `siguiente()`.
//
// Retenciones (Track R, relevado el 2026-09-08 — docs/tango/sql/retenciones-relevamiento-2026-09-08.txt):
//   la oficina NUNCA usó el módulo de retenciones de Tango en las cobranzas (la tabla de
//   detalle CTA_COMPROBANTE_RETENCION_VENTAS está vacía en las tres bases). Cada retención
//   es un medio más del recibo: un renglón SBA05 'D' sobre la cuenta de tesorería de
//   retenciones de ese tipo (1132010 RETENCION IIBB BS. AS., 1132012 CABA, 1132018 IVA,
//   1132004 GANANCIAS, 1131003 SUSS — config `retenciones[tipo].cuenta`, por empresa) con la
//   SUMA de los certificados de ese tipo, saldo de SBA01 y renglón del asiento como cualquier
//   otra cuenta. El nº y la fecha del certificado van en LEYENDA (40) y COMENTARIO del renglón.

import {
  type EjecutorSql, type SentenciaSql,
  varchar, numeric, datetime, bit, int, smallint, float,
  soloDia, horaHHMMSS, numeroComprobanteTango, insert, FECHA_NULA_TANGO,
} from './tipos'

export interface ConfigReciboSql {
  /** Talonario de recibos EXCLUSIVO de la app en Tango (REC, letra X) y su punto de venta. */
  talonario: number
  puntoVenta: number
  /** Vendedor que queda en el recibo (GVA12.COD_VENDED). */
  codVendedor: string
  concepto: string                      // 'COBRANZAS POR VENTAS'
  /** Cuentas de tesorería: contracuenta (deudores) y por medio de pago. `cheques` = cartera de
   *  cheques de terceros (VALORES A DEPOSITAR 1112000), `echeq` = cheques electrónicos (1112002). */
  cuentas: { contracuenta: number; efectivo: number; transferencia?: number; cheques?: number; echeq?: number }
  /** Cuenta CONTABLE (ASIENTO_SB.ID_CUENTA) por cuenta de tesorería — consulta (d) §21.3. */
  cuentasContables: Record<string, number>
  /** SBA02.ID_SBA02 del tipo de comprobante REC en Tesorería (11 en TestingRH — consulta (e)). */
  idSba02Recibo: number
  usuario: string
  terminal: string
  /** Cheques de terceros (SBA14). Si falta algo se lee de Tango al escribir. */
  cheques?: {
    /** SBA14.NRO_SUCURS (3 en la traza). Si no está, se copia del último cheque cargado. */
    nroSucursal?: number
    /** Tabla y columna de bancos de Tango para resolver ID_BANCO desde el código BCRA del cheque. */
    tablaBancos?: string          // default 'BANCO'
    columnaCodigoBanco?: string   // default 'COD_BANCO'
    /** Mapeo directo código BCRA → ID_BANCO, por si la tabla usa otros códigos. Gana sobre la consulta. */
    bancos?: Record<string, number>
  }
  /** Retenciones que la app captura (tipo → cuenta de tesorería de "retenciones sufridas" de
   *  ese tipo y código de retención del catálogo de Tango). Por empresa vía
   *  `config/tango.sql.empresas.<e>.recibo.retenciones`. Un tipo sin entrada frena con error legible. */
  retenciones?: Partial<Record<TipoRetencion, { cuenta: number; codigoTango?: string }>>
}

/** Tipos de retención que carga el supervisor (src/types.ts → TipoRetencion). */
export type TipoRetencion = 'ganancias' | 'iva' | 'iibb_caba' | 'iibb_pba' | 'suss'
export const TIPOS_RETENCION: TipoRetencion[] = ['ganancias', 'iva', 'iibb_caba', 'iibb_pba', 'suss']

export interface RetencionTango {
  tipo: TipoRetencion
  cuenta: number             // cuenta de tesorería de retenciones de ese tipo
  codigoTango?: string       // código de retención del catálogo de Tango (detalle del certificado)
  nroCertificado: string
  fecha: Date                // fecha del certificado
  importe: number
}

export interface ChequeTango {
  numero: number
  bancoCodigo: string        // código BCRA que cargó el supervisor ('007' Galicia)
  fechaEmision: Date
  fechaCobro: Date
  dias: number
  importe: number
  cuenta: number             // cartera donde entra (cheques o echeq)
  esEcheq: boolean
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
  medios: MedioTango[]           // incluye un renglón por cuenta de cartera (suma de cheques) y por cuenta de retención (suma de certificados)
  cheques: ChequeTango[]
  retenciones: RetencionTango[]
  leyenda: string                // ROLITO:<cobranzaId>
}

/** Retención tal como la guarda la app en cobranzas.medios.retenciones (src/types.ts → RetencionRecibida). */
export interface RetencionPayload {
  tipo?: string
  nroCertificado?: string
  importe?: number
  fecha?: string                 // yyyy-MM-dd (obligatoria desde el 2026-09-08; las viejas pueden no traerla)
}

/** Cheque tal como lo guarda la app en cobranzas.medios.cheques (src/types.ts → ChequeRecibido). */
export interface ChequePayload {
  numero?: string
  bancoCodigo?: string
  bancoNombre?: string
  fechaEmision?: string          // yyyy-MM-dd
  fechaAcreditacion?: string     // yyyy-MM-dd
  dias?: number
  importe?: number
  esEcheq?: boolean
}

/** Payload de la cobranza tal como lo encola onCobranzaCreada (tango-outbox, entidad 'recibo'). */
export interface PayloadCobranza {
  numeroRecibo?: string           // 'RS-000123'
  clienteCodigoTango?: string | null
  importe?: number
  fecha?: unknown
  imputaciones?: { comprobanteTipo: string; comprobanteNumero: string; importeImputado: number }[]
  medios?: { efectivo?: number; transferencia?: number; cheques?: ChequePayload[]; retenciones?: RetencionPayload[] }
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
  // Cheques: uno o más por cuenta de cartera (papel / e-cheq). El renglón de tesorería de
  // cada cartera lleva la SUMA; cada cheque va aparte a SBA14 (ver chequeDePayload).
  const cheques = (m.cheques ?? []).map((c, i) => chequeDePayload(c, i, cfg))
  for (const cuenta of [...new Set(cheques.map((c) => c.cuenta))]) {
    medios.push({ cuenta, importe: r2(cheques.filter((c) => c.cuenta === cuenta).reduce((s, c) => s + c.importe, 0)) })
  }

  // Retenciones: mismo esquema que los cheques — un renglón de tesorería por cuenta de
  // retención con la SUMA, y el detalle de cada certificado aparte (ver retencionDePayload).
  const retenciones = (m.retenciones ?? []).map((x, i) => retencionDePayload(x, i, cfg))
  for (const cuenta of [...new Set(retenciones.map((x) => x.cuenta))]) {
    if (!medios.some((med) => med.cuenta === cuenta)) medios.push({ cuenta, importe: r2(retenciones.filter((x) => x.cuenta === cuenta).reduce((s, x) => s + x.importe, 0)) })
    else throw new Error(`la cuenta de retenciones ${cuenta} coincide con otra cuenta de tesorería del recibo; revisar config/tango.sql.recibo.retenciones`)
  }

  const importe = r2(Number(p.importe ?? 0))
  const sumImp = r2(imputaciones.reduce((s, i) => s + i.importe, 0))
  const sumMed = r2(medios.reduce((s, x) => s + x.importe, 0))
  if (sumImp !== importe || sumMed !== importe) throw new Error(`el recibo no cierra: importe ${importe}, imputado ${sumImp}, medios ${sumMed}`)
  return {
    numero, puntoVenta: cfg.puntoVenta,
    nComp: numeroComprobanteTango('X', cfg.puntoVenta, numero),
    codCliente: p.clienteCodigoTango, fecha: fechaDe(p.fecha), importe, imputaciones, medios, cheques, retenciones,
    leyenda: p.referenciaIdempotente ?? `ROLITO:${cobranzaId}`,
  }
}

function retencionDePayload(x: RetencionPayload, i: number, cfg: ConfigReciboSql): RetencionTango {
  const tipo = String(x.tipo ?? '').trim() as TipoRetencion
  if (!TIPOS_RETENCION.includes(tipo)) throw new Error(`retención ${i + 1}: tipo desconocido "${x.tipo}"`)
  const map = cfg.retenciones?.[tipo]
  if (!map?.cuenta) throw new Error(`retención ${tipo}: sin cuenta de tesorería configurada (config/tango.sql.recibo.retenciones.${tipo}.cuenta)`)
  const importe = r2(Number(x.importe ?? 0))
  if (!(importe > 0)) throw new Error(`retención ${tipo}: importe inválido`)
  const nroCertificado = String(x.nroCertificado ?? '').trim()
  if (!nroCertificado) throw new Error(`retención ${tipo}: sin número de certificado`)
  const fecha = fechaDeIso(x.fecha)
  if (!fecha) throw new Error(`retención ${tipo} ${nroCertificado}: sin fecha de certificado (Tango la exige)`)
  return { tipo, cuenta: map.cuenta, codigoTango: map.codigoTango, nroCertificado, fecha, importe }
}

function chequeDePayload(c: ChequePayload, i: number, cfg: ConfigReciboSql): ChequeTango {
  const numero = Number(String(c.numero ?? '').replace(/\D/g, ''))
  if (!numero) throw new Error(`cheque ${i + 1}: número inválido "${c.numero}"`)
  const importe = r2(Number(c.importe ?? 0))
  if (!(importe > 0)) throw new Error(`cheque ${numero}: importe inválido`)
  const bancoCodigo = String(c.bancoCodigo ?? '').trim()
  if (!bancoCodigo) throw new Error(`cheque ${numero}: sin código de banco`)
  const fechaEmision = fechaDeIso(c.fechaEmision)
  const fechaCobro = c.fechaAcreditacion ? fechaDeIso(c.fechaAcreditacion) : fechaEmision
  if (!fechaEmision || !fechaCobro) throw new Error(`cheque ${numero}: fechas inválidas (${c.fechaEmision} / ${c.fechaAcreditacion})`)
  const dias = c.dias != null ? Number(c.dias) : Math.round((fechaCobro.getTime() - fechaEmision.getTime()) / 86400000)
  const esEcheq = c.esEcheq === true
  const cuenta = esEcheq ? cfg.cuentas.echeq : cfg.cuentas.cheques
  if (!cuenta) throw new Error(`cobranza con ${esEcheq ? 'e-cheq' : 'cheque'} sin cuenta de cartera configurada (config/tango.sql.recibo.cuentas.${esEcheq ? 'echeq' : 'cheques'})`)
  return { numero, bancoCodigo, fechaEmision, fechaCobro, dias: Math.max(0, dias), importe, cuenta, esEcheq }
}

/** 'yyyy-MM-dd' → Date local a las 00:00 (como guarda Tango F_EMISION / FECHA_CHEQ). */
function fechaDeIso(s: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
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
  cliente: { idGva14: number; saldoCc: number; saldoDoc: number; saldoDUn: number; saldoCcU: number; cuit?: string; razonSocial?: string }
  /** Por cheque (mismo orden que ReciboTango.cheques): nº interno de SBA14 e ID_BANCO de Tango. */
  cheques?: { nInterno: number; idBanco: number }[]
  /** SBA14.NRO_SUCURS a usar (config o el del último cheque cargado en Tango). */
  nroSucursalCheques?: number
  /** Procedimiento de recálculo de estados si existe en la base ('dbo.P_COBRANZAESTADOSVENTAS'), o null. */
  spEstados?: string | null
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

  // 3b. Recalcular estados (factura PEN→CAN, vencimientos PEN→PAG, recibo CTA/IMP).
  //     NO lo hace un trigger: la pantalla de Cobranzas llama al procedimiento
  //     dbo.P_COBRANZAESTADOSVENTAS con la lista '(idFactura, ..., idRecibo)' después de
  //     insertar las imputaciones (traza 2026-09-05; sin esto la factura queda PEN aunque
  //     esté imputada al 100%, como pasó con la 282328 el 2026-09-05). Si la base no
  //     tiene el procedimiento (Rolito, 2026-09-05) se saltea y se avisa.
  if (d.spEstados) {
    out.push(marcarListaIds({
      etiqueta: `EXEC ${d.spEstados}`,
      sql: `EXEC ${d.spEstados} @LISTAIDGVA12 = @LISTA`,
      params: [varchar('LISTA', '', -1)],   // -1 = varchar(max); el valor se arma al ejecutar con el ID del recibo
    }))
  }

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

  // 6. SBA05 — renglón 0 contracuenta 'H', luego un renglón 'D' por medio. El renglón de una
  //    cuenta de retenciones lleva el certificado en LEYENDA/COMENTARIO (Tango los deja en blanco).
  const renglones: { cuenta: number; dh: 'D' | 'H'; importe: number; leyenda?: string; comentario?: string }[] = [
    { cuenta: cfg.cuentas.contracuenta, dh: 'H', importe: r.importe },
    ...r.medios.map((m) => ({ cuenta: m.cuenta, dh: 'D' as const, importe: m.importe, ...textoRetenciones(r.retenciones.filter((x) => x.cuenta === m.cuenta)) })),
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
      varchar('LEYENDA', ren.leyenda ?? '', ren.leyenda ? 40 : 1),
      numeric('MONTO', ren.importe),
      varchar('N_COMP', r.nComp, 14),
      int('RENGLON', i),
      numeric('UNIDADES', ren.importe),
      varchar('VA_DIRECTO', 'N', 1),
      int('ID_SBA02', cfg.idSba02Recibo),
      int('ID_GVA81', null),
      varchar('COMENTARIO', ren.comentario ?? '', ren.comentario ? 255 : 1),
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

  // 7b. Cheques de terceros: SBA14 (cartera) + SBA23 (historial) + vínculo con el renglón de
  //     tesorería de su cuenta (MOVIMIENTO_CHEQUE_TERCERO, resuelto al ejecutar). Traza del 2026-09-05.
  r.cheques.forEach((ch, i) => {
    const dc = d.cheques?.[i]
    if (!dc) throw new Error(`falta leer los datos del cheque ${ch.numero} (nº interno / banco)`)
    const cuit = (d.cliente.cuit ?? '').slice(0, 13)
    const razon = (d.cliente.razonSocial ?? '').slice(0, 60)
    out.push(marcarIdSba14(insert(`INSERT SBA14 cheque ${ch.numero}`, 'SBA14', [
      smallint('BARRA_REC', 0), smallint('BARRA_RECH', 0), smallint('BARRA_SAL', 0),
      varchar('CLIENTE', r.codCliente, 6),
      float('CTA_CARTER', ch.cuenta), float('CTA_DESTIN', 0), float('CTA_RECEP', ch.cuenta),
      varchar('CUENTA_TIP', 'C', 1),
      smallint('DIAS', ch.dias),
      varchar('ESTADO', 'C', 1),                       // C = en cartera
      datetime('F_EMISION', soloDia(ch.fechaEmision)),
      datetime('FECHA_CHEQ', soloDia(ch.fechaCobro)),
      datetime('FECHA_REC', fecha),
      datetime('FECHA_RECH', FECHA_NULA_TANGO), datetime('FECHA_SAL', FECHA_NULA_TANGO),
      numeric('IMPORTE_CH', ch.importe),
      float('N_CHEQUE', ch.numero),
      varchar('N_COMP_REC', r.nComp, 14), varchar('N_COMP_RCH', '', 1), varchar('N_COMP_SAL', '', 1),
      varchar('N_CUIT', cuit, 13),
      float('N_INTERNO', dc.nInterno),
      varchar('REGISTRADO', 'N', 1),
      varchar('T_COMP_REC', 'REC', 3), varchar('T_COMP_RCH', '', 1), varchar('T_COMP_SAL', '', 1),
      varchar('TIPO_CHEQU', ch.dias > 0 ? 'D' : 'C', 1),   // D = diferido, C = común
      varchar('TIPO_SAL', '', 1),
      smallint('ULT_BARRA', 0), varchar('ULT_N_COMP', r.nComp, 14), varchar('ULT_T_COMP', 'REC', 3),
      bit('EXPORTADO', false),
      smallint('NRO_SUCURS', d.nroSucursalCheques ?? 0),
      float('N_INT_ORI', dc.nInterno),
      int('ID_BANCO', dc.idBanco),
      int('ID_SBA02_REC', cfg.idSba02Recibo), int('ID_SBA02_ULT', cfg.idSba02Recibo),
      bit('CONCILIADO_SAL', false), varchar('COMENTARIO_SAL', '', 1),
      bit('CONCILIADO_RECH', false), varchar('COMENTARIO_RECH', '', 1),
      varchar('COD_GVA14', r.codCliente, 6),
      varchar('RAZON_EMIS', razon, 60),
    ], true), i))
    out.push(insert(`INSERT SBA23 cheque ${ch.numero}`, 'SBA23', [
      smallint('BARRA', 0), varchar('CLIENTE', r.codCliente, 6), varchar('ESTADO', 'C', 1),
      datetime('FECHA_MOV', fecha), varchar('HORA_MOV', hora.slice(0, 4), 4),
      varchar('N_COMP', r.nComp, 14), float('N_INTERNO', dc.nInterno), varchar('T_COMP', 'REC', 3),
      varchar('USUARIO', usr, 10),
    ], true))
    out.push(marcarVinculoCheque(insert(`INSERT MOVIMIENTO_CHEQUE_TERCERO cheque ${ch.numero}`, 'MOVIMIENTO_CHEQUE_TERCERO', [
      int('ID_SBA14', -1), int('ID_SBA05', -1), varchar('TIPO_MOVIMIENTO', 'INGR', 4),
    ], true), i, ch.cuenta))
  })

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

const ETIQUETA_RETENCION: Record<TipoRetencion, string> = { ganancias: 'RET GCIAS', iva: 'RET IVA', iibb_caba: 'RET IIBB CABA', iibb_pba: 'RET IIBB PBA', suss: 'RET SUSS' }
const ddmmaa = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`

/** Texto del certificado para el renglón de tesorería: LEYENDA corta (40) y COMENTARIO completo (255). */
export function textoRetenciones(rets: RetencionTango[]): { leyenda?: string; comentario?: string } {
  if (!rets.length) return {}
  const partes = rets.map((x) => `${ETIQUETA_RETENCION[x.tipo]} CERT ${x.nroCertificado} ${ddmmaa(x.fecha)} $${x.importe.toFixed(2)}`)
  const leyenda = (rets.length === 1 ? `${ETIQUETA_RETENCION[rets[0].tipo]} CERT ${rets[0].nroCertificado}` : `${ETIQUETA_RETENCION[rets[0].tipo]} ${rets.length} CERTIFICADOS`).slice(0, 40)
  return { leyenda, comentario: partes.join(' | ').slice(0, 255) }
}

// Marcadores para ids que recién existen al ejecutar (el del recibo GVA12 y el del
// asiento cuando ASIENTO_COMPROBANTE_SB es IDENTITY). `escribirRecibo` los reemplaza.
export interface SentenciaConMarcador extends SentenciaSql {
  necesitaIdRecibo?: boolean
  necesitaIdAsiento?: boolean
  /** INSERT SBA14: al ejecutar, su SCOPE_IDENTITY es el ID_SBA14 del cheque nº `chequeIdx`. */
  chequeIdx?: number
  /** EXEC del recálculo de estados: el parámetro LISTA se arma al ejecutar como '(idFactura, ..., idRecibo)'. */
  necesitaListaIds?: boolean
  /** INSERT MOVIMIENTO_CHEQUE_TERCERO: necesita el ID_SBA14 del cheque `vinculaCheque` y el ID_SBA05 del renglón de `cuentaCartera`. */
  vinculaCheque?: number
  cuentaCartera?: number
}
const marcarIdRecibo = (s: SentenciaSql): SentenciaConMarcador => ({ ...s, necesitaIdRecibo: true })
const marcarIdAsiento = (s: SentenciaSql, si: boolean): SentenciaConMarcador => (si ? { ...s, necesitaIdAsiento: true } : s)
const marcarIdSba14 = (s: SentenciaSql, chequeIdx: number): SentenciaConMarcador => ({ ...s, chequeIdx })
const marcarListaIds = (s: SentenciaSql): SentenciaConMarcador => ({ ...s, necesitaListaIds: true })
const marcarVinculoCheque = (s: SentenciaSql, vinculaCheque: number, cuentaCartera: number): SentenciaConMarcador => ({ ...s, vinculaCheque, cuentaCartera })

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

  // Recálculo de estados: existe en REDONHIELO_SA/TestingRH; en Rolito no apareció (2026-09-05).
  const sp = await db.query<{ ID: number | null }>(`SELECT OBJECT_ID('dbo.P_COBRANZAESTADOSVENTAS', 'P') AS ID`)
  const spEstados = sp[0]?.ID != null ? 'dbo.P_COBRANZAESTADOSVENTAS' : null

  // Cheques: CUIT y razón social del cliente (el librador, como lo precarga la pantalla),
  // ID_BANCO por código BCRA, sucursal y nº interno de cada cheque.
  let cliCheques: { cuit?: string; razonSocial?: string } = {}
  let cheques: DatosRecibo['cheques']
  let nroSucursalCheques: number | undefined
  if (r.cheques.length) {
    for (const t of ['SBA14', 'SBA23', 'MOVIMIENTO_CHEQUE_TERCERO']) {
      if (!identity.has(t)) throw new Error(`${t} no tiene columna IDENTITY: hay que relevar cómo asigna Tango su id antes de escribir cheques`)
    }
    try {
      const q = await db.query<{ CUIT: string | null; RAZON_SOCI: string | null }>(`SELECT CUIT, RAZON_SOCI FROM GVA14 WHERE COD_GVA14 = @COD`, [varchar('COD', r.codCliente, 6)])
      cliCheques = { cuit: (q[0]?.CUIT ?? '').trim(), razonSocial: (q[0]?.RAZON_SOCI ?? '').trim() }
    } catch { cliCheques = {} }
    nroSucursalCheques = cfg.cheques?.nroSucursal
    if (nroSucursalCheques == null) {
      const s = await db.query<{ N: number | null }>(`SELECT TOP 1 NRO_SUCURS AS N FROM SBA14 ORDER BY ID_SBA14 DESC`)
      nroSucursalCheques = Number(s[0]?.N ?? 0) || 0
    }
    const tabla = cfg.cheques?.tablaBancos ?? 'BANCO'
    const col = cfg.cheques?.columnaCodigoBanco ?? 'COD_BANCO'
    cheques = []
    for (const ch of r.cheques) {
      let idBanco = cfg.cheques?.bancos?.[ch.bancoCodigo]
      if (idBanco == null) {
        const b = await db.query<{ ID_BANCO: number }>(`SELECT ID_BANCO FROM ${tabla} WHERE ${col} = @COD`, [varchar('COD', ch.bancoCodigo, 10)])
        if (!b.length) throw new Error(`el banco ${ch.bancoCodigo} del cheque ${ch.numero} no existe en Tango (${tabla}.${col}); cargarlo o mapearlo en config/tango.sql.recibo.cheques.bancos`)
        idBanco = Number(b[0].ID_BANCO)
      }
      cheques.push({ nInterno: await siguiente(db, 'SBA14', 'N_INTERNO'), idBanco })
    }
  }

  const ids: IdsRecibo = {
    historial: await Promise.all(r.imputaciones.map(() => identity.has('HISTORIAL_CUENTAS_CORRIENTES') ? null : siguiente(db, 'HISTORIAL_CUENTAS_CORRIENTES', 'ID_HISTORIAL_CUENTAS_CORRIENTES'))),
    cotizacion: identity.has('COMPROBANTE_COTIZACION_SB') ? null : await siguiente(db, 'COMPROBANTE_COTIZACION_SB', 'ID_COMPROBANTE_COTIZACION_SB'),
    asientoComprobante: identity.has('ASIENTO_COMPROBANTE_SB') ? null : await siguiente(db, 'ASIENTO_COMPROBANTE_SB', 'ID_ASIENTO_COMPROBANTE_SB'),
    asientoRenglones: [],
  }
  const nRenglones = 1 + r.medios.length
  for (let i = 0; i < nRenglones; i++) ids.asientoRenglones.push(identity.has('ASIENTO_SB') ? null : await siguiente(db, 'ASIENTO_SB', 'ID_ASIENTO_SB'))

  return {
    cliente: { idGva14: c.ID_GVA14, saldoCc: Number(c.SALDO_CC), saldoDoc: Number(c.SALDO_DOC), saldoDUn: Number(c.SALDO_D_UN), saldoCcU: Number(c.SALDO_CC_U), ...cliCheques },
    facturas, cuentas, nInternoSba04, ids, cheques, nroSucursalCheques, spEstados,
  }
}

/**
 * Próximo valor de un id/contador de Tango, en este orden:
 *  1. Si la columna tiene DEFAULT `NEXT VALUE FOR SEQUENCE_x` (Delta 6: HISTORIAL_CUENTAS_CORRIENTES,
 *     COMPROBANTE_COTIZACION_SB, ASIENTO_COMPROBANTE_SB y ASIENTO_SB — script 04), se pide a esa
 *     secuencia. Si el login no tiene UPDATE sobre la secuencia el error sale tal cual (nunca se
 *     cae a MAX+1: chocaría con Tango más adelante).
 *  2. dbo.INCREMENTAL_VALUE (como hace Tango con SBA04.N_INTERNO).
 *  3. MAX+1 (último recurso, solo si no hay ni secuencia ni contador).
 */
async function siguiente(db: EjecutorSql, tabla: string, campo: string): Promise<number> {
  const def = await db.query<{ D: string | null }>(
    `SELECT dc.definition AS D FROM sys.columns c JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id WHERE c.object_id = OBJECT_ID(@T) AND c.name = @C`,
    [varchar('T', tabla, 128), varchar('C', campo, 128)],
  )
  let seq = def[0]?.D ? /NEXT VALUE FOR \[?(?:dbo\]?\.\[?)?(\w+)\]?/i.exec(def[0].D)?.[1] : undefined
  if (!seq) {
    // El login del servicio puede no ver la definición del DEFAULT (visibilidad de metadata);
    // Tango nombra las secuencias SEQUENCE_<tabla>, y con UPDATE sobre ellas sí aparecen en sys.sequences.
    const porNombre = await db.query<{ name: string }>(`SELECT name FROM sys.sequences WHERE name = @S`, [varchar('S', `SEQUENCE_${tabla.toUpperCase()}`, 128)])
    seq = porNombre[0]?.name
  }
  if (seq) {
    const v = await db.query<{ V: number }>(`SELECT NEXT VALUE FOR [${seq}] AS V`)
    if (v[0]?.V == null) throw new Error(`la secuencia ${seq} (${tabla}.${campo}) no devolvió valor`)
    return Number(v[0].V)
  }
  const inc = await db.query<{ UltimoValor: number }>(`SELECT UltimoValor FROM dbo.INCREMENTAL_VALUE WHERE Tabla = @T AND Campo = @C`, [varchar('T', tabla, 50), varchar('C', campo, 50)])
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
  const rows = await db.query<{ tabla: string }>(`SELECT OBJECT_NAME(object_id) AS tabla FROM sys.identity_columns WHERE OBJECT_NAME(object_id) IN ('GVA12','GVA07','HISTORIAL_CUENTAS_CORRIENTES','SBA04','SBA05','COMPROBANTE_COTIZACION_SB','ASIENTO_COMPROBANTE_SB','ASIENTO_SB','SBA14','SBA23','MOVIMIENTO_CHEQUE_TERCERO')`)
  return new Set(rows.map((x) => x.tabla.toUpperCase()))
}

export interface ResultadoReciboSql {
  yaExistia: boolean
  idGva12: number | null
  nComp: string
  nInternoSba04: number | null
  /** Cheques grabados en cartera (SBA14), para el log y el write-back. */
  cheques?: { numero: number; idSba14: number | null; nInterno: number | null }[]
}

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
  const idSba05PorCuenta = new Map<number, number>()   // renglón 'D' de cada cuenta de cartera
  const idSba14PorCheque = new Map<number, number>()   // índice del cheque → ID_SBA14
  for (const s of sentenciasRecibo(r, datos, cfg) as SentenciaConMarcador[]) {
    const params = s.params.map((p) => {
      if (s.necesitaIdRecibo && p.nombre === 'ID_GVA12_CAN') return { ...p, valor: idGva12 }
      if (s.necesitaIdAsiento && p.nombre === 'ID_ASIENTO_COMPROBANTE_SB') return { ...p, valor: idAsiento }
      if (s.necesitaListaIds && p.nombre === 'LISTA') {
        const ids = [...r.imputaciones.map((imp) => datos.facturas[clave(imp)]?.idGva12).filter((x): x is number => x != null), ...(idGva12 != null ? [idGva12] : [])]
        return { ...p, valor: `(${ids.join(', ')})` }
      }
      if (s.vinculaCheque != null && p.nombre === 'ID_SBA14') return { ...p, valor: idSba14PorCheque.get(s.vinculaCheque) ?? null }
      if (s.cuentaCartera != null && p.nombre === 'ID_SBA05') return { ...p, valor: idSba05PorCuenta.get(s.cuentaCartera) ?? null }
      return p
    })
    if ((s.necesitaIdRecibo || s.necesitaListaIds) && idGva12 == null) throw new Error('no se obtuvo el ID_GVA12 del recibo')
    if (s.vinculaCheque != null && (params.find((p) => p.nombre === 'ID_SBA14')?.valor == null || params.find((p) => p.nombre === 'ID_SBA05')?.valor == null)) {
      throw new Error(`${s.etiqueta}: no se obtuvo el ID_SBA14 del cheque o el ID_SBA05 del renglón de cartera ${s.cuentaCartera}`)
    }
    const filas = await db.query<{ ID?: number; affected?: number }>(s.sql, params)
    log(s.etiqueta)
    if (s.etiqueta === 'INSERT GVA12' && filas[0]?.ID != null) idGva12 = Number(filas[0].ID)
    if (s.etiqueta === 'INSERT ASIENTO_COMPROBANTE_SB' && idAsiento == null && filas[0]?.ID != null) idAsiento = Number(filas[0].ID)
    const renglonD = /^INSERT SBA05 (\d+) D$/.exec(s.etiqueta)
    if (renglonD && filas[0]?.ID != null) idSba05PorCuenta.set(Number(renglonD[1]), Number(filas[0].ID))
    if (s.chequeIdx != null && filas[0]?.ID != null) idSba14PorCheque.set(s.chequeIdx, Number(filas[0].ID))
    if (s.etiqueta.startsWith('UPDATE') && filas[0]?.affected === 0) throw new Error(`${s.etiqueta}: el saldo cambió mientras se grababa el recibo; se reintenta`)
  }
  const res: ResultadoReciboSql = { yaExistia: false, idGva12, nComp: r.nComp, nInternoSba04: datos.nInternoSba04 }
  if (r.cheques.length) res.cheques = r.cheques.map((c, i) => ({ numero: c.numero, idSba14: idSba14PorCheque.get(i) ?? null, nInterno: datos.cheques?.[i]?.nInterno ?? null }))
  return res
}
