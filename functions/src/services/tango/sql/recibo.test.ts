import { describe, it, expect } from 'vitest'
import { reciboDeCobranza, sentenciasRecibo, escribirRecibo, textoRetenciones, type ConfigReciboSql, type DatosRecibo, type PayloadCobranza } from './recibo'
import type { EjecutorSql, ParametroSql } from './tipos'

const cfg: ConfigReciboSql = {
  talonario: 1106, puntoVenta: 1106, codVendedor: 'AD', concepto: 'COBRANZAS POR VENTAS',
  cuentas: { contracuenta: 1120001, efectivo: 1111000, transferencia: 1113003, cheques: 1112000, echeq: 1112002 },
  cuentasContables: { '1120001': 1062, '1111000': 601, '1113003': 610, '1112000': 602, '1112002': 603 },
  idSba02Recibo: 11, usuario: 'ROLITO', terminal: 'APP',
}

// Cheque como lo carga el supervisor en la app (ChequeRecibido), igual al de la traza del 2026-09-05.
const cheque = { numero: '12345678', bancoCodigo: '007', bancoNombre: 'Galicia', fechaEmision: '2026-09-05', fechaAcreditacion: '2026-10-05', dias: 30, importe: 35682 }

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
    expect(() => reciboDeCobranza({ ...payload, medios: { efectivo: 1000, transferencia: 0, cheques: [], retenciones: [{}] }, importe: 1000, imputaciones: [payload.imputaciones![0]] }, 'c', cfg)).toThrow(/tipo desconocido/)
    expect(() => reciboDeCobranza({ ...payload, medios: { efectivo: 0, transferencia: 0, cheques: [{ numero: '', importe: 1000 }], retenciones: [] }, importe: 1000, imputaciones: [payload.imputaciones![0]] }, 'c', cfg)).toThrow(/número inválido/)
    expect(() => reciboDeCobranza({ ...payload, medios: { efectivo: 0, transferencia: 0, cheques: [cheque], retenciones: [] }, importe: 1000, imputaciones: [payload.imputaciones![0]] }, 'c', { ...cfg, cuentas: { contracuenta: 1120001, efectivo: 1111000 } })).toThrow(/cuenta de cartera/)
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

function fakeDb(opts: { existe?: boolean; identity?: string[]; secuencias?: string[]; secuenciasPorNombre?: string[]; sinSpEstados?: boolean } = {}) {
  const secuencias: Record<string, number> = {}
  const ejecutadas: string[] = []
  const vinculos: { idSba14: number; idSba05: number }[] = []
  const listas: string[] = []   // listas de ids con las que se llamó al recálculo de estados
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
      if (sql.startsWith('SELECT OBJECT_ID(\'dbo.P_COBRANZAESTADOSVENTAS\'')) return r([{ ID: opts.sinSpEstados ? null : 9001 }])
      if (sql.startsWith('EXEC dbo.P_COBRANZAESTADOSVENTAS')) { listas.push(String(param(params, 'LISTA'))); return r([{ affected: 0 }]) }
      if (sql.startsWith('SELECT CUIT, RAZON_SOCI')) return r([{ CUIT: '20-23994197-5', RAZON_SOCI: 'QUIROGA HUGO WALTER' }])
      if (sql.startsWith('SELECT TOP 1 NRO_SUCURS')) return r([{ N: 3 }])
      if (sql.startsWith('SELECT ID_BANCO FROM')) return r(param(params, 'COD') === '007' ? [{ ID_BANCO: 209 }] : [])
      if (sql.startsWith('SELECT MAX(N_INTERNO) AS M FROM SBA14')) return r([{ M: 51096 }])
      if (sql.startsWith('INSERT INTO "GVA12"')) return r([{ ID: 372480 }])
      if (sql.startsWith('INSERT INTO "ASIENTO_COMPROBANTE_SB"')) return r([{ ID: 199999 }])
      if (sql.startsWith('INSERT INTO "SBA05"')) return r([{ ID: 367600 + Number(param(params, 'RENGLON')) }])
      if (sql.startsWith('INSERT INTO "SBA14"')) return r([{ ID: 68900 + Number(param(params, 'N_CHEQUE')) % 100 }])
      if (sql.startsWith('INSERT INTO "MOVIMIENTO_CHEQUE_TERCERO"')) { vinculos.push({ idSba14: Number(param(params, 'ID_SBA14')), idSba05: Number(param(params, 'ID_SBA05')) }); return r([{ ID: 1 }]) }
      if (sql.startsWith('INSERT')) return r([{ ID: 1 }])
      if (sql.startsWith('UPDATE')) return r([{ affected: 1 }])
      throw new Error('consulta inesperada: ' + sql)
    },
  }
  return { db, ejecutadas, vinculos, listas }
}

describe('recálculo de estados (dbo.P_COBRANZAESTADOSVENTAS, traza 2026-09-05)', () => {
  const p1 = { ...payload, importe: 1000, imputaciones: [payload.imputaciones![0]], medios: { efectivo: 1000, transferencia: 0 } }
  const r = reciboDeCobranza(p1, 'cob1', cfg)
  it('va después de las imputaciones y antes del saldo del cliente, solo si la base tiene el procedimiento', () => {
    const con = sentenciasRecibo(r, { ...datos, spEstados: 'dbo.P_COBRANZAESTADOSVENTAS' }, cfg).map((s) => s.etiqueta)
    expect(con.slice(0, 5)).toEqual(['INSERT GVA12', 'INSERT gva07 A0010100268582', 'INSERT HISTORIAL_CUENTAS_CORRIENTES A0010100268582', 'EXEC dbo.P_COBRANZAESTADOSVENTAS', 'UPDATE GVA14 saldo'])
    const sin = sentenciasRecibo(r, datos, cfg).map((s) => s.etiqueta)
    expect(sin.some((e) => e.startsWith('EXEC'))).toBe(false)
  })
  it('al ejecutar le pasa los ids de las facturas imputadas y el del recibo recién insertado', async () => {
    const { db, listas } = fakeDb()
    await escribirRecibo(db, r, cfg)
    expect(listas).toEqual(['(350532, 372480)'])
  })
  it('si la base no tiene el procedimiento (Rolito) no lo llama', async () => {
    const { db, listas } = fakeDb({ sinSpEstados: true })
    await escribirRecibo(db, r, cfg)
    expect(listas).toEqual([])
  })
})

describe('cheques de terceros (traza 2026-09-05: X0110600000002, cheque diferido a VALORES A DEPOSITAR)', () => {
  const pCheque: PayloadCobranza = {
    ...payload, importe: 35682, imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: 'A0010100282315', importeImputado: 35682 }],
    medios: { efectivo: 0, transferencia: 0, cheques: [cheque], retenciones: [] },
  }
  const r = reciboDeCobranza(pCheque, 'cob2', cfg)
  const datosCheque: DatosRecibo = {
    ...datos, cheques: [{ nInterno: 51097, idBanco: 209 }], nroSucursalCheques: 3,
    cliente: { ...datos.cliente, cuit: '20-23994197-5', razonSocial: 'QUIROGA HUGO WALTER' },
    cuentas: { ...datos.cuentas, '1112000': { idSba01: 2, saldoAMo: 87971825.63, saldoAUn: 87971825.63, saldoAct: 87971825.63 } },
    ids: { ...datos.ids, asientoRenglones: [240050, 240051] },
  }

  it('el cheque es un medio sobre la cuenta de cartera por la suma, y queda en la lista de cheques', () => {
    expect(r.medios).toEqual([{ cuenta: 1112000, importe: 35682 }])
    expect(r.cheques).toHaveLength(1)
    expect(r.cheques[0]).toMatchObject({ numero: 12345678, bancoCodigo: '007', dias: 30, importe: 35682, cuenta: 1112000, esEcheq: false })
    expect(r.cheques[0].fechaEmision).toEqual(new Date(2026, 8, 5))
    expect(r.cheques[0].fechaCobro).toEqual(new Date(2026, 9, 5))
  })
  it('dos cheques de la misma cartera → un solo renglón de tesorería; el e-cheq va a su cuenta', () => {
    const p2: PayloadCobranza = { ...pCheque, importe: 50000, imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: 'A0010100282315', importeImputado: 50000 }],
      medios: { efectivo: 0, transferencia: 0, cheques: [{ ...cheque, importe: 20000 }, { ...cheque, numero: '222', importe: 20000 }, { ...cheque, numero: '333', importe: 10000, esEcheq: true }], retenciones: [] } }
    const r2 = reciboDeCobranza(p2, 'cob3', cfg)
    expect(r2.medios).toEqual([{ cuenta: 1112000, importe: 40000 }, { cuenta: 1112002, importe: 10000 }])
    expect(r2.cheques.map((c) => c.cuenta)).toEqual([1112000, 1112000, 1112002])
  })
  it('las sentencias siguen el orden de Tango: SBA05 de cartera, cotización, SBA14 + SBA23 + vínculo, saldos, asiento', () => {
    const ss = sentenciasRecibo(r, datosCheque, cfg, new Date(2026, 8, 5, 14, 17, 49))
    expect(ss.map((s) => s.etiqueta)).toEqual([
      'INSERT GVA12',
      'INSERT gva07 A0010100282315', 'INSERT HISTORIAL_CUENTAS_CORRIENTES A0010100282315',
      'UPDATE GVA14 saldo',
      'INSERT SBA04',
      'INSERT SBA05 1120001 H', 'INSERT SBA05 1112000 D',
      'INSERT COMPROBANTE_COTIZACION_SB',
      'INSERT SBA14 cheque 12345678', 'INSERT SBA23 cheque 12345678', 'INSERT MOVIMIENTO_CHEQUE_TERCERO cheque 12345678',
      'UPDATE SBA01 saldo 1120001', 'UPDATE SBA01 saldo 1112000',
      'INSERT ASIENTO_COMPROBANTE_SB', 'INSERT ASIENTO_SB 1120001', 'INSERT ASIENTO_SB 1112000',
    ])
    const sba14 = ss[8].params
    expect(sba14).toHaveLength(43)
    expect(param(sba14, 'CLIENTE')).toBe('FC.280')
    expect(param(sba14, 'CTA_CARTER')).toBe(1112000)
    expect(param(sba14, 'CTA_RECEP')).toBe(1112000)
    expect(param(sba14, 'CTA_DESTIN')).toBe(0)
    expect(param(sba14, 'DIAS')).toBe(30)
    expect(param(sba14, 'ESTADO')).toBe('C')
    expect(param(sba14, 'TIPO_CHEQU')).toBe('D')
    expect(param(sba14, 'F_EMISION')).toEqual(new Date(2026, 8, 5))
    expect(param(sba14, 'FECHA_CHEQ')).toEqual(new Date(2026, 9, 5))
    expect(param(sba14, 'FECHA_RECH')).toEqual(new Date(1800, 0, 1))
    expect(param(sba14, 'IMPORTE_CH')).toBe(35682)
    expect(param(sba14, 'N_CHEQUE')).toBe(12345678)
    expect(param(sba14, 'N_COMP_REC')).toBe('X0110600000123')
    expect(param(sba14, 'ULT_N_COMP')).toBe('X0110600000123')
    expect(param(sba14, 'N_CUIT')).toBe('20-23994197-5')
    expect(param(sba14, 'N_INTERNO')).toBe(51097)
    expect(param(sba14, 'N_INT_ORI')).toBe(51097)
    expect(param(sba14, 'NRO_SUCURS')).toBe(3)
    expect(param(sba14, 'ID_BANCO')).toBe(209)
    expect(param(sba14, 'ID_SBA02_REC')).toBe(11)
    expect(param(sba14, 'RAZON_EMIS')).toBe('QUIROGA HUGO WALTER')
    expect(ss[8].sql).toContain('SCOPE_IDENTITY')
    const sba23 = ss[9].params
    expect(param(sba23, 'ESTADO')).toBe('C')
    expect(param(sba23, 'HORA_MOV')).toBe('1417')
    expect(param(sba23, 'N_INTERNO')).toBe(51097)
    expect(param(sba23, 'USUARIO')).toBe('ROLITO')
    expect(param(ss[10].params, 'TIPO_MOVIMIENTO')).toBe('INGR')
    expect(param(ss[15].params, 'ID_CUENTA')).toBe(602)   // contable de VALORES A DEPOSITAR
    expect(param(ss[12].params, 'MO')).toBeCloseTo(88007507.63, 2)   // cartera: +35682, como la traza
  })
  it('un cheque al día es común (TIPO_CHEQU C, 0 días)', () => {
    const r0 = reciboDeCobranza({ ...pCheque, medios: { efectivo: 0, transferencia: 0, cheques: [{ ...cheque, fechaAcreditacion: '2026-09-05', dias: 0 }], retenciones: [] } }, 'c', cfg)
    const ss = sentenciasRecibo(r0, datosCheque, cfg)
    expect(param(ss[8].params, 'TIPO_CHEQU')).toBe('C')
    expect(param(ss[8].params, 'DIAS')).toBe(0)
  })
  it('al ejecutar: lee CUIT/razón social, sucursal y banco, reserva el nº interno del cheque y ata SBA14 con el renglón de cartera', async () => {
    const { db, ejecutadas, vinculos } = fakeDb({ identity: ['SBA14', 'SBA23', 'MOVIMIENTO_CHEQUE_TERCERO'] })
    const res = await escribirRecibo(db, r, cfg)
    expect(res.cheques).toEqual([{ numero: 12345678, idSba14: 68978, nInterno: 51097 }])   // MAX(N_INTERNO)+1 del fake
    expect(vinculos).toEqual([{ idSba14: 68978, idSba05: 367601 }])   // renglón 1 = cartera 'D'
    expect(ejecutadas.some((e) => e.startsWith('SELECT CUIT, RAZON_SOCI'))).toBe(true)
    expect(ejecutadas.some((e) => e.startsWith('SELECT ID_BANCO FROM BANCO'))).toBe(true)
    expect(ejecutadas.some((e) => e.startsWith('SELECT TOP 1 NRO_SUCURS'))).toBe(true)
  })
  it('con sucursal y banco en la config no consulta Tango por ellos', async () => {
    const { db, ejecutadas } = fakeDb({ identity: ['SBA14', 'SBA23', 'MOVIMIENTO_CHEQUE_TERCERO'] })
    await escribirRecibo(db, r, { ...cfg, cheques: { nroSucursal: 3, bancos: { '007': 209 } } })
    expect(ejecutadas.some((e) => e.startsWith('SELECT ID_BANCO FROM'))).toBe(false)
    expect(ejecutadas.some((e) => e.startsWith('SELECT TOP 1 NRO_SUCURS'))).toBe(false)
  })
  it('si el banco del cheque no está en Tango, frena con un error claro', async () => {
    const { db } = fakeDb({ identity: ['SBA14', 'SBA23', 'MOVIMIENTO_CHEQUE_TERCERO'] })
    const rOtro = reciboDeCobranza({ ...pCheque, medios: { efectivo: 0, transferencia: 0, cheques: [{ ...cheque, bancoCodigo: '999' }], retenciones: [] } }, 'c', cfg)
    await expect(escribirRecibo(db, rOtro, cfg)).rejects.toThrow(/banco 999/)
  })
  it('si SBA14 no fuera IDENTITY frena antes de escribir', async () => {
    const { db } = fakeDb()
    await expect(escribirRecibo(db, r, cfg)).rejects.toThrow(/IDENTITY/)
  })
})

describe('retenciones (Track R, 2026-09-08: medio sobre la cuenta de retenciones del tipo; detalle pendiente de traza)', () => {
  const cfgRet: ConfigReciboSql = { ...cfg, retenciones: { iibb_caba: { cuenta: 1130010, codigoTango: 'RIBC' }, ganancias: { cuenta: 1130001 } } }
  const ret = { tipo: 'iibb_caba', nroCertificado: '0001-00004567', importe: 500, fecha: '2026-09-08' }
  const pRet: PayloadCobranza = { ...payload, importe: 1500, medios: { efectivo: 1000, transferencia: 0, cheques: [], retenciones: [ret] } }

  it('la retención es un medio sobre la cuenta de su tipo y queda en la lista con fecha y certificado', () => {
    const r = reciboDeCobranza(pRet, 'c', cfgRet)
    expect(r.medios).toEqual([{ cuenta: 1111000, importe: 1000 }, { cuenta: 1130010, importe: 500 }])
    expect(r.retenciones).toEqual([{ tipo: 'iibb_caba', cuenta: 1130010, codigoTango: 'RIBC', nroCertificado: '0001-00004567', fecha: new Date(2026, 8, 8), importe: 500 }])
  })
  it('dos certificados del mismo tipo → un solo renglón de tesorería con la suma; tipos distintos, uno cada uno', () => {
    const r = reciboDeCobranza({ ...pRet, importe: 2000, imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: 'A0010100268582', importeImputado: 2000 }],
      medios: { efectivo: 1000, transferencia: 0, cheques: [], retenciones: [ret, { ...ret, nroCertificado: '0001-00004568', importe: 300 }, { ...ret, tipo: 'ganancias', importe: 200 }] } }, 'c', cfgRet)
    expect(r.medios).toEqual([{ cuenta: 1111000, importe: 1000 }, { cuenta: 1130010, importe: 800 }, { cuenta: 1130001, importe: 200 }])
    expect(r.retenciones).toHaveLength(3)
  })
  it('frena con error legible si el tipo no está mapeado, no tiene fecha o certificado, o la suma no cierra', () => {
    expect(() => reciboDeCobranza({ ...pRet, medios: { efectivo: 1000, transferencia: 0, cheques: [], retenciones: [{ ...ret, tipo: 'suss' }] } }, 'c', cfgRet)).toThrow(/retenciones\.suss\.cuenta/)
    expect(() => reciboDeCobranza({ ...pRet, medios: { efectivo: 1000, transferencia: 0, cheques: [], retenciones: [{ ...ret, fecha: undefined }] } }, 'c', cfgRet)).toThrow(/sin fecha de certificado/)
    expect(() => reciboDeCobranza({ ...pRet, medios: { efectivo: 1000, transferencia: 0, cheques: [], retenciones: [{ ...ret, nroCertificado: ' ' }] } }, 'c', cfgRet)).toThrow(/sin número de certificado/)
    expect(() => reciboDeCobranza({ ...pRet, medios: { efectivo: 1000, transferencia: 0, cheques: [], retenciones: [{ ...ret, importe: 400 }] } }, 'c', cfgRet)).toThrow(/no cierra/)
    expect(() => reciboDeCobranza(pRet, 'c', cfg)).toThrow(/sin cuenta de tesorería configurada/)
  })
  it('en Tango es un renglón de tesorería más (como lo carga la oficina): SBA05 D con el certificado en leyenda, saldo SBA01 y asiento', () => {
    const cfgR = { ...cfgRet, cuentasContables: { ...cfg.cuentasContables, '1130010': 640 } }
    const datosR: DatosRecibo = { ...datos, cuentas: { ...datos.cuentas, '1130010': { idSba01: 28, saldoAMo: 1000, saldoAUn: 1000, saldoAct: 1000 } }, ids: { ...datos.ids, asientoRenglones: [1, 2, 3] } }
    const r = reciboDeCobranza(pRet, 'c', cfgR)
    const s = sentenciasRecibo(r, datosR, cfgR)
    const ren = s.find((x) => x.etiqueta === 'INSERT SBA05 1130010 D')!
    expect(param(ren.params, 'MONTO')).toBe(500)
    expect(param(ren.params, 'LEYENDA')).toBe('RET IIBB CABA CERT 0001-00004567')
    expect(String(param(ren.params, 'COMENTARIO'))).toContain('08/09/26 $500.00')
    expect(param(s.find((x) => x.etiqueta === 'INSERT SBA05 1111000 D')!.params, 'LEYENDA')).toBe('')
    expect(param(s.find((x) => x.etiqueta === 'UPDATE SBA01 saldo 1130010')!.params, 'ACT')).toBe(1500)
    expect(param(s.find((x) => x.etiqueta === 'INSERT ASIENTO_SB 1130010')!.params, 'ID_CUENTA')).toBe(640)
    expect(s.filter((x) => x.etiqueta.startsWith('INSERT SBA14'))).toHaveLength(0)
  })
  it('dos certificados en la misma cuenta → leyenda con la cantidad y comentario con ambos', () => {
    expect(textoRetenciones([
      { tipo: 'iibb_pba', cuenta: 1132010, nroCertificado: '000100001188', fecha: new Date(2026, 8, 8), importe: 10805.4 },
      { tipo: 'iibb_pba', cuenta: 1132010, nroCertificado: '000100001190', fecha: new Date(2026, 8, 9), importe: 100 },
    ])).toEqual({ leyenda: 'RET IIBB PBA 2 CERTIFICADOS', comentario: 'RET IIBB PBA CERT 000100001188 08/09/26 $10805.40 | RET IIBB PBA CERT 000100001190 09/09/26 $100.00' })
  })
})

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
