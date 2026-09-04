import { describe, it, expect } from 'vitest'
import { reciboDeCobranza, sentenciasRecibo, escribirRecibo, type ConfigReciboSql, type DatosRecibo, type PayloadCobranza } from './recibo'
import type { EjecutorSql, ParametroSql } from './tipos'

const cfg: ConfigReciboSql = {
  talonario: 1106, puntoVenta: 1106, codVendedor: 'AD', concepto: 'COBRANZAS POR VENTAS',
  cuentas: { contracuenta: 1120001, efectivo: 1111000, transferencia: 1113003 },
  cuentasContables: { '1120001': 1062, '1111000': 601, '1113003': 610 },
  idSba02Recibo: 11, usuario: 'ROLITO', terminal: 'APP',
}

const payload: PayloadCobranza = {
  numeroRecibo: 'RS-000123', clienteCodigoTango: 'FC.280', importe: 1500,
  fecha: { seconds: Math.floor(new Date(2026, 8, 4, 11, 0).getTime() / 1000) },
  imputaciones: [
    { comprobanteTipo: 'FAC', comprobanteNumero: 'A0010100268582', importeImputado: 1000 },
    { comprobanteTipo: 'FAC', comprobanteNumero: 'A0010100282315', importeImputado: 500 },
  ],
  medios: { efectivo: 1000, transferencia: 500, cheques: [], retenciones: [] },
  referenciaIdempotente: 'ROLITO:cob1',
}

const datos: DatosRecibo = {
  cliente: { idGva14: 8465, saldoCc: 3873642, saldoDoc: 0, saldoDUn: 0, saldoCcU: 3873642 },
  facturas: {
    'FAC|A0010100268582': { idGva12: 350532, importe: 110700, unidades: 110700, fechaVto: new Date(2026, 1, 4) },
    'FAC|A0010100282315': { idGva12: 360000, importe: 242000, unidades: 242000, fechaVto: new Date(2026, 7, 31) },
  },
  cuentas: {
    '1120001': { idSba01: 223, saldoAMo: -16877316239.08, saldoAUn: -16865035193.68, saldoAct: -16877316239.08 },
    '1111000': { idSba01: 1, saldoAMo: -2911497195.15, saldoAUn: -2911497195.15, saldoAct: -2911497195.15 },
    '1113003': { idSba01: 40, saldoAMo: 100, saldoAUn: 100, saldoAct: 100 },
  },
  nInternoSba04: 127987,
  ids: { historial: [233986, 233987], cotizacion: 190077, asientoComprobante: 199354, asientoRenglones: [240046, 240047, 240048] },
}

const param = (ps: ParametroSql[], nombre: string) => ps.find((p) => p.nombre === nombre)?.valor

describe('reciboDeCobranza', () => {
  it('arma el número X + pv + nº y separa imputaciones y medios', () => {
    const r = reciboDeCobranza(payload, 'cob1', cfg)
    expect(r.nComp).toBe('X0110600000123')
    expect(r.numero).toBe(123)
    expect(r.importe).toBe(1500)
    expect(r.imputaciones).toEqual([{ tComp: 'FAC', nComp: 'A0010100268582', importe: 1000 }, { tComp: 'FAC', nComp: 'A0010100282315', importe: 500 }])
    expect(r.medios).toEqual([{ cuenta: 1111000, importe: 1000 }, { cuenta: 1113003, importe: 500 }])
    expect(r.leyenda).toBe('ROLITO:cob1')
  })
  it('rechaza lo que no cierra o no se puede escribir todavía', () => {
    expect(() => reciboDeCobranza({ ...payload, importe: 1400 }, 'c', cfg)).toThrow(/no cierra/)
    expect(() => reciboDeCobranza({ ...payload, medios: { efectivo: 1000, transferencia: 0, cheques: [{}], retenciones: [] }, importe: 1000, imputaciones: [payload.imputaciones![0]] }, 'c', cfg)).toThrow(/cheques y retenciones/)
    expect(() => reciboDeCobranza({ ...payload, clienteCodigoTango: null }, 'c', cfg)).toThrow(/clienteCodigoTango/)
    expect(() => reciboDeCobranza({ ...payload, medios: { efectivo: 0, transferencia: 1500 } }, 'c', { ...cfg, cuentas: { contracuenta: 1120001, efectivo: 1111000 } })).toThrow(/transferencia/)
  })
})

describe('sentenciasRecibo', () => {
  const r = reciboDeCobranza(payload, 'cob1', cfg)
  const ss = sentenciasRecibo(r, datos, cfg, new Date(2026, 8, 4, 11, 2, 3))

  it('sigue el orden de Tango: GVA12, imputaciones + historial, GVA14, SBA04, SBA05, cotización, SBA01, asiento', () => {
    expect(ss.map((s) => s.etiqueta)).toEqual([
      'INSERT GVA12',
      'INSERT gva07 A0010100268582', 'INSERT HISTORIAL_CUENTAS_CORRIENTES A0010100268582',
      'INSERT gva07 A0010100282315', 'INSERT HISTORIAL_CUENTAS_CORRIENTES A0010100282315',
      'UPDATE GVA14 saldo',
      'INSERT SBA04',
      'INSERT SBA05 1120001 H', 'INSERT SBA05 1111000 D', 'INSERT SBA05 1113003 D',
      'INSERT COMPROBANTE_COTIZACION_SB',
      'UPDATE SBA01 saldo 1120001', 'UPDATE SBA01 saldo 1111000', 'UPDATE SBA01 saldo 1113003',
      'INSERT ASIENTO_COMPROBANTE_SB', 'INSERT ASIENTO_SB 1120001', 'INSERT ASIENTO_SB 1111000', 'INSERT ASIENTO_SB 1113003',
    ])
  })
  it('el recibo en GVA12 copia la traza y deja NCOMP_IN_V en 0 para el trigger', () => {
    const p = ss[0].params
    expect(p).toHaveLength(39)
    expect(param(p, 'T_COMP')).toBe('REC')
    expect(param(p, 'TCOMP_IN_V')).toBe('RC')
    expect(param(p, 'ESTADO')).toBe('IMP')
    expect(param(p, 'N_COMP')).toBe('X0110600000123')
    expect(param(p, 'TALONARIO')).toBe(1106)
    expect(param(p, 'IMPORTE')).toBe(1500)
    expect(param(p, 'UNIDADES')).toBe(1500)
    expect(param(p, 'NCOMP_IN_V')).toBe(0)
    expect(param(p, 'REBAJA_DEB')).toBe(true)
    expect(param(p, 'COD_VENDED')).toBe('AD')
    expect(param(p, 'LEYENDA_1')).toBe('ROLITO:cob1')
    expect(param(p, 'HORA_COMP')).toBe('110203')
  })
  it('la imputación referencia factura y recibo con el importe original de la factura', () => {
    const p = ss[1].params
    expect(param(p, 'T_COMP')).toBe('FAC')
    expect(param(p, 'N_COMP')).toBe('A0010100268582')
    expect(param(p, 'T_COMP_CAN')).toBe('REC')
    expect(param(p, 'N_COMP_CAN')).toBe('X0110600000123')
    expect(param(p, 'IMPORTE_VT')).toBe(110700)
    expect(param(p, 'IMPORT_CAN')).toBe(1000)
    expect(param(p, 'ID_GVA12_CAN')).toBe(-1)   // marcador: lo pone el ejecutor
    expect(param(ss[2].params, 'ID_HISTORIAL_CUENTAS_CORRIENTES')).toBe(233986)
    expect(param(ss[2].params, 'ORIGEN')).toBe('Cobranzas')
  })
  it('el saldo del cliente baja el importe con concurrencia optimista', () => {
    const p = ss[5].params
    expect(param(p, 'SALDO_CC')).toBe(3872142)
    expect(param(p, 'SALDO_CC_U')).toBe(3872142)
    expect(param(p, 'ANT_CC')).toBe(3873642)
    expect(ss[5].sql).toContain('"SALDO_CC"=@ANT_CC')
  })
  it('tesorería: cabecera con N_INTERNO del contador, contracuenta al haber y medios al debe', () => {
    expect(param(ss[6].params, 'N_INTERNO')).toBe(127987)
    expect(param(ss[6].params, 'ID_SBA02')).toBe(11)
    expect(param(ss[6].params, 'TOTAL_IMPORTE_CTE')).toBe(1500)
    expect(param(ss[7].params, 'COD_CTA')).toBe(1120001)
    expect(param(ss[7].params, 'D_H')).toBe('H')
    expect(param(ss[7].params, 'RENGLON')).toBe(0)
    expect(param(ss[7].params, 'MONTO')).toBe(1500)
    expect(param(ss[8].params, 'COD_CTA')).toBe(1111000)
    expect(param(ss[8].params, 'D_H')).toBe('D')
    expect(param(ss[8].params, 'MONTO')).toBe(1000)
    expect(param(ss[9].params, 'MONTO')).toBe(500)
  })
  it('los saldos de las cuentas se mueven como en la traza: debe suma, haber resta', () => {
    expect(param(ss[11].params, 'MO')).toBeCloseTo(-16877317739.08, 2)   // deudores: −1500
    expect(param(ss[12].params, 'MO')).toBeCloseTo(-2911496195.15, 2)    // caja: +1000
    expect(param(ss[13].params, 'MO')).toBe(600)                          // banco: +500
    expect(param(ss[12].params, 'ID')).toBe(1)
  })
  it('el asiento contable mapea cada cuenta de tesorería a su cuenta contable', () => {
    expect(param(ss[14].params, 'ID_ASIENTO_COMPROBANTE_SB')).toBe(199354)
    expect(param(ss[14].params, 'N_INTERNO')).toBe(127987)
    expect(param(ss[15].params, 'ID_CUENTA')).toBe(1062)
    expect(param(ss[15].params, 'D_H')).toBe('H')
    expect(param(ss[16].params, 'ID_CUENTA')).toBe(601)
    expect(param(ss[16].params, 'EDITA_CUENTA')).toBe('S')
    expect(param(ss[17].params, 'ID_CUENTA')).toBe(610)
  })
  it('si una tabla es IDENTITY no manda el id', () => {
    const sinIds = sentenciasRecibo(r, { ...datos, ids: { historial: [null, null], cotizacion: null, asientoComprobante: null, asientoRenglones: [null, null, null] } }, cfg)
    expect(sinIds[2].params.some((p) => p.nombre === 'ID_HISTORIAL_CUENTAS_CORRIENTES')).toBe(false)
    expect(sinIds[14].sql).toContain('SCOPE_IDENTITY')
    expect(param(sinIds[15].params, 'ID_ASIENTO_COMPROBANTE_SB')).toBe(-1)
  })
})

function fakeDb(opts: { existe?: boolean; identity?: string[]; secuencias?: string[]; secuenciasPorNombre?: string[] } = {}) {
  const secuencias: Record<string, number> = {}
  const ejecutadas: string[] = []
  const contadores: Record<string, number> = { 'SBA04|N_INTERNO': 127986, 'HISTORIAL_CUENTAS_CORRIENTES|ID_HISTORIAL_CUENTAS_CORRIENTES': 233985, 'COMPROBANTE_COTIZACION_SB|ID_COMPROBANTE_COTIZACION_SB': 190076, 'ASIENTO_COMPROBANTE_SB|ID_ASIENTO_COMPROBANTE_SB': 199353, 'ASIENTO_SB|ID_ASIENTO_SB': 240045 }
  const db: EjecutorSql = {
    async query<T>(sql: string, params: ParametroSql[] = []): Promise<T[]> {
      ejecutadas.push(sql.slice(0, 40))
      const r = (rows: unknown[]) => rows as T[]
      if (sql.startsWith('SELECT ID_GVA12 FROM GVA12 WHERE T_COMP = \'REC\'')) return r(opts.existe ? [{ ID_GVA12: 777 }] : [])
      if (sql.startsWith('SELECT OBJECT_NAME(object_id) AS tabla')) return r((opts.identity ?? []).map((t) => ({ tabla: t })))
      if (sql.startsWith('SELECT ID_GVA14, SALDO_CC')) return r([{ ID_GVA14: 8465, SALDO_CC: 3873642, SALDO_DOC: 0, SALDO_D_UN: 0, SALDO_CC_U: 3873642 }])
      if (sql.startsWith('SELECT ID_GVA12, IMPORTE, UNIDADES')) return r([{ ID_GVA12: param(params, 'N') === 'A0010100268582' ? 350532 : 360000, IMPORTE: 110700, UNIDADES: 110700, COD_CLIENT: 'FC.280' }])
      if (sql.startsWith('SELECT TOP 1 FECHA_VTO')) return r([{ FECHA_VTO: new Date(2026, 1, 4) }])
      if (sql.startsWith('SELECT ID_SBA01')) return r([{ ID_SBA01: Number(param(params, 'COD')) === 1111000 ? 1 : 223, SALDO_A_MO: -100, SALDO_A_UN: -100, SALDO_ACT: -100 }])
      if (sql.startsWith('SELECT name FROM sys.sequences')) return r((opts.secuenciasPorNombre ?? []).includes(param(params, 'S') as string) ? [{ name: param(params, 'S') }] : [])
      if (sql.startsWith('SELECT dc.definition AS D')) { const sq = `SEQUENCE_${param(params, 'T')}`; return r((opts.secuencias ?? []).includes(sq) ? [{ D: `(NEXT VALUE FOR [${sq}])` }] : []) }
      if (sql.startsWith('SELECT NEXT VALUE FOR')) { const n = sql.slice(sql.indexOf('[') + 1, sql.indexOf(']')); secuencias[n] = (secuencias[n] ?? 1000) + 1; return r([{ V: secuencias[n] }]) }
      if (sql.startsWith('SELECT UltimoValor')) { const k = `${param(params, 'T')}|${param(params, 'C')}`; return r(k in contadores ? [{ UltimoValor: contadores[k] }] : []) }
      if (sql.startsWith('UPDATE dbo.INCREMENTAL_VALUE')) { contadores[`${param(params, 'T')}|${param(params, 'C')}`] = Number(param(params, 'V')); return r([{ affected: 1 }]) }
      if (sql.startsWith('INSERT INTO "GVA12"')) return r([{ ID: 372480 }])
      if (sql.startsWith('INSERT INTO "ASIENTO_COMPROBANTE_SB"')) return r([{ ID: 199999 }])
      if (sql.startsWith('INSERT')) return r([{ ID: 1 }])
      if (sql.startsWith('UPDATE')) return r([{ affected: 1 }])
      throw new Error('consulta inesperada: ' + sql)
    },
  }
  return { db, ejecutadas }
}

describe('escribirRecibo', () => {
  const p1 = { ...payload, importe: 1000, imputaciones: [payload.imputaciones![0]], medios: { efectivo: 1000, transferencia: 0 } }
  const r = reciboDeCobranza(p1, 'cob1', cfg)
  it('reserva contadores, inserta el recibo y pasa su ID a las imputaciones', async () => {
    const { db, ejecutadas } = fakeDb()
    const res = await escribirRecibo(db, r, cfg)
    expect(res).toEqual({ yaExistia: false, idGva12: 372480, nComp: 'X0110600000123', nInternoSba04: 127987 })
    expect(ejecutadas.filter((e) => e.startsWith('INSERT'))).toHaveLength(1 + 2 + 1 + 2 + 1 + 1 + 2)
    expect(ejecutadas.filter((e) => e.startsWith('UPDATE dbo.INCREMENTAL_VALUE'))).toHaveLength(1 + 1 + 1 + 1 + 2)
  })
  it('con tablas IDENTITY no reserva contadores para ellas y toma el id del asiento al insertarlo', async () => {
    const { db, ejecutadas } = fakeDb({ identity: ['HISTORIAL_CUENTAS_CORRIENTES', 'COMPROBANTE_COTIZACION_SB', 'ASIENTO_COMPROBANTE_SB', 'ASIENTO_SB'] })
    await escribirRecibo(db, r, cfg)
    expect(ejecutadas.filter((e) => e.startsWith('UPDATE dbo.INCREMENTAL_VALUE'))).toHaveLength(1)   // solo SBA04.N_INTERNO
  })
  it('con SEQUENCE detrás (Delta 6) toma los ids con NEXT VALUE FOR y no toca INCREMENTAL_VALUE para esas tablas', async () => {
    const { db, ejecutadas } = fakeDb({ secuencias: ['SEQUENCE_HISTORIAL_CUENTAS_CORRIENTES', 'SEQUENCE_COMPROBANTE_COTIZACION_SB', 'SEQUENCE_ASIENTO_COMPROBANTE_SB', 'SEQUENCE_ASIENTO_SB'] })
    await escribirRecibo(db, r, cfg)
    expect(ejecutadas.filter((e) => e.startsWith('SELECT NEXT VALUE FOR'))).toHaveLength(1 + 1 + 1 + 2)
    expect(ejecutadas.filter((e) => e.startsWith('UPDATE dbo.INCREMENTAL_VALUE'))).toHaveLength(1)   // solo SBA04.N_INTERNO
  })
  it('si no ve el DEFAULT pero sí la secuencia por nombre (SEQUENCE_<tabla>), la usa igual', async () => {
    const { db, ejecutadas } = fakeDb({ secuenciasPorNombre: ['SEQUENCE_HISTORIAL_CUENTAS_CORRIENTES', 'SEQUENCE_COMPROBANTE_COTIZACION_SB', 'SEQUENCE_ASIENTO_COMPROBANTE_SB', 'SEQUENCE_ASIENTO_SB'] })
    await escribirRecibo(db, r, cfg)
    expect(ejecutadas.filter((e) => e.startsWith('SELECT NEXT VALUE FOR'))).toHaveLength(1 + 1 + 1 + 2)
    expect(ejecutadas.filter((e) => e.startsWith('UPDATE dbo.INCREMENTAL_VALUE'))).toHaveLength(1)
  })
  it('si ya existe no escribe', async () => {
    const { db, ejecutadas } = fakeDb({ existe: true })
    const res = await escribirRecibo(db, r, cfg)
    expect(res.yaExistia).toBe(true)
    expect(ejecutadas).toHaveLength(1)
  })
})
