import { describe, it, expect } from 'vitest'
import {
  aplicarDescuentos, claveComprobante, comprobantesDe, descontarCobranza, descuentosDeCobranzas,
  fusionarRamaEmpresa, normalizarComprobante, vaciarRamaEmpresa, type ComprobanteSaldo, type SaldoDoc,
} from './saldos'
import { agregarTangoId, codigoTangoDe, idGva14De, tangoIdsDe } from './empresas'

const comp = (empresa: 'redonhielo' | 'rolito', numero: string, saldo: number, extra: Partial<ComprobanteSaldo> = {}): ComprobanteSaldo =>
  normalizarComprobante({ tipo: 'FAC', numero, saldoPendiente: saldo, importeOriginal: saldo, ...extra }, empresa, extra.codigoTango ?? 'FC.280')

describe('normalizarComprobante', () => {
  it('etiqueta empresa y código, redondea y omite opcionales vacíos', () => {
    const c = normalizarComprobante({ tipo: 'FAC', numero: 'A0010100000001', saldoPendiente: 10.005, diasAtraso: 0, fechaVencimiento: '' }, 'rolito', 'FC.280')
    expect(c).toEqual({ tipo: 'FAC', numero: 'A0010100000001', fechaEmision: '', importeOriginal: 10.01, saldoPendiente: 10.01, empresa: 'rolito', codigoTango: 'FC.280' })
  })
  it('respeta el código que ya trae el comprobante (varios códigos por CUIT)', () => {
    expect(normalizarComprobante({ codigoTango: 'FC.281', saldoPendiente: 1 }, 'redonhielo', 'FC.280').codigoTango).toBe('FC.281')
  })
})

describe('comprobantesDe', () => {
  it('trata los docs viejos sin empresa por fila como Redonhielo', () => {
    const viejos = comprobantesDe({ codigoTango: 'FC.280', comprobantes: [{ tipo: 'FAC', numero: '1', saldoPendiente: 5 } as ComprobanteSaldo] })
    expect(viejos[0]).toMatchObject({ empresa: 'redonhielo', codigoTango: 'FC.280', saldoPendiente: 5 })
  })
})

describe('fusionarRamaEmpresa', () => {
  it('crea el doc con una sola empresa', () => {
    const doc = fusionarRamaEmpresa(undefined, 'redonhielo', [comp('redonhielo', '1', 100)], { runId: 'r1', origen: 'sync' }, { idGva14: 9, codigoTango: 'FC.280', razonSocial: 'Quiroga' })
    expect(doc.saldoTotal).toBe(100)
    expect(doc.porEmpresa.redonhielo).toMatchObject({ saldoTotal: 100, comprobantes: 1, runId: 'r1' })
    expect(doc.porEmpresa.rolito).toBeUndefined()
    expect(doc.empresa).toBe('redonhielo')
    expect(doc.runId).toBe('r1')
  })

  it('reemplaza solo la rama de la empresa y suma las dos en saldoTotal', () => {
    const base = fusionarRamaEmpresa(undefined, 'redonhielo', [comp('redonhielo', '1', 100)], { runId: 'r1', origen: 'sync' })
    const conRolito = fusionarRamaEmpresa(base, 'rolito', [comp('rolito', '1', 30), comp('rolito', '2', 20)], { runId: 'x1', origen: 'sync' })
    expect(conRolito.saldoTotal).toBe(150)
    expect(conRolito.comprobantes.map((c) => `${c.empresa}:${c.numero}`)).toEqual(['redonhielo:1', 'rolito:1', 'rolito:2'])
    expect(conRolito.porEmpresa.redonhielo?.runId).toBe('r1')
    expect(conRolito.porEmpresa.rolito).toMatchObject({ saldoTotal: 50, comprobantes: 2, runId: 'x1' })

    // Nueva corrida de Redonhielo: Rolito queda intacto.
    const rh2 = fusionarRamaEmpresa(conRolito, 'redonhielo', [comp('redonhielo', '7', 1)], { runId: 'r2', origen: 'sync' })
    expect(rh2.saldoTotal).toBe(51)
    expect(rh2.comprobantes.filter((c) => c.empresa === 'rolito')).toHaveLength(2)
    expect(rh2.porEmpresa.redonhielo?.runId).toBe('r2')
    expect(rh2.porEmpresa.rolito?.runId).toBe('x1')
  })

  it('la misma factura (tipo+número) puede existir en las dos empresas', () => {
    const doc = fusionarRamaEmpresa(
      fusionarRamaEmpresa(undefined, 'redonhielo', [comp('redonhielo', 'A0110400000062', 10)], { runId: 'a', origen: 'sync' }),
      'rolito', [comp('rolito', 'A0110400000062', 20)], { runId: 'b', origen: 'consulta' },
    )
    expect(doc.comprobantes).toHaveLength(2)
    expect(doc.saldoTotal).toBe(30)
  })

  it('conserva las cobranzas aplicadas previas y suma las nuevas sin duplicar', () => {
    const base: Partial<SaldoDoc> = { cobranzasAplicadas: ['c1'], comprobantes: [], porEmpresa: {} }
    const doc = fusionarRamaEmpresa(base, 'rolito', [], { runId: 'x', origen: 'sync' }, {}, ['c1', 'c2'])
    expect(doc.cobranzasAplicadas).toEqual(['c1', 'c2'])
  })

  it('vaciarRamaEmpresa deja la otra empresa y marca el runId nuevo', () => {
    const doc = fusionarRamaEmpresa(
      fusionarRamaEmpresa(undefined, 'redonhielo', [comp('redonhielo', '1', 100)], { runId: 'r1', origen: 'sync' }),
      'rolito', [comp('rolito', '1', 30)], { runId: 'x1', origen: 'sync' },
    )
    const vacio = vaciarRamaEmpresa(doc, 'redonhielo', 'r2')
    expect(vacio.saldoTotal).toBe(30)
    expect(vacio.porEmpresa.redonhielo).toMatchObject({ saldoTotal: 0, comprobantes: 0, runId: 'r2' })
    expect(vacio.comprobantes.every((c) => c.empresa === 'rolito')).toBe(true)
  })
})

describe('descuentos de cobranzas pendientes', () => {
  const cobranzas = [
    { id: 'c1', clienteId: 'u1', empresa: 'rolito', imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: '1', importeImputado: 10 }], tango: { estado: 'enviado' } },
    { id: 'c2', clienteId: 'u1', imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: '1', importeImputado: 100 }] },          // sin empresa = redonhielo (cobranzas viejas)
    { id: 'c3', clienteId: 'u1', empresa: 'rolito', imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: '1', importeImputado: 5 }], tango: { estado: 'confirmado' } },
    { id: 'c4', clienteId: 'u2', empresa: 'redonhielo', imputaciones: [] },
  ]

  it('agrupa por cliente y por empresa+tipo+número, ignorando las confirmadas y las sin imputaciones', () => {
    const d = descuentosDeCobranzas(cobranzas)
    expect(d.get('u1')?.cobranzaIds).toEqual(['c1', 'c2'])
    expect(d.get('u1')?.porComprobante.get(claveComprobante('rolito', 'FAC', '1'))).toBe(1000)
    expect(d.get('u1')?.porComprobante.get(claveComprobante('redonhielo', 'FAC', '1'))).toBe(10000)
    expect(d.has('u2')).toBe(false)
  })

  it('aplicarDescuentos resta solo en la empresa correcta y descarta lo saldado', () => {
    const d = descuentosDeCobranzas(cobranzas).get('u1')
    const res = aplicarDescuentos([comp('rolito', '1', 30), comp('redonhielo', '1', 100), comp('redonhielo', '2', 7)], d)
    expect(res.map((c) => [c.empresa, c.numero, c.saldoPendiente])).toEqual([['rolito', '1', 20], ['redonhielo', '2', 7]])
  })

  it('pago a cuenta (2026-09-08): mientras Tango no confirme, el recibo aparece como saldo NEGATIVO en su empresa y código', () => {
    const cob = { id: 'c7', clienteId: 'u3', empresa: 'redonhielo', codigoTango: 'BU.017', numeroRecibo: 'RS-000190', fecha: new Date(2026, 8, 8),
      imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: '5', importeImputado: 100 }], aCuenta: 40.5 }
    const d = descuentosDeCobranzas([cob, { id: 'c8', clienteId: 'u3', empresa: 'rolito', imputaciones: [], aCuenta: 10 }]).get('u3')!
    expect(d.cobranzaIds).toEqual(['c7', 'c8'])
    expect(d.aCuenta.map((a) => [a.empresa, a.tipo, a.numero, a.saldoPendiente, a.codigoTango, a.fechaEmision]))
      .toEqual([['redonhielo', 'REC', 'RS-000190', -40.5, 'BU.017', '2026-09-08'], ['rolito', 'REC', 'c8', -10, '', '']])
    const res = aplicarDescuentos([comp('redonhielo', '5', 100), comp('redonhielo', '6', 20)], d)
    expect(res.map((c) => [c.empresa, c.tipo, c.numero, c.saldoPendiente])).toEqual([['redonhielo', 'FAC', '6', 20], ['redonhielo', 'REC', 'RS-000190', -40.5], ['rolito', 'REC', 'c8', -10]])
    // Confirmada en Tango: ya no se inventa nada (la composición real la trae la sync).
    expect(descuentosDeCobranzas([{ ...cob, tango: { estado: 'confirmado' } }]).has('u3')).toBe(false)
    // Un recibo a cuenta que Tango ya trae con saldo negativo se conserva y no se duplica.
    const conRec = aplicarDescuentos([{ ...comp('redonhielo', 'RS-000190', -40.5), tipo: 'REC' }], d)
    expect(conRec.filter((c) => c.tipo === 'REC' && c.empresa === 'redonhielo')).toHaveLength(1)
  })

  it('descontarCobranza con a cuenta suma el negativo al saldo de la empresa', () => {
    const doc = fusionarRamaEmpresa(undefined, 'redonhielo', [comp('redonhielo', '1', 100)], { runId: 'r1', origen: 'sync' })
    const r = descontarCobranza(doc, { id: 'c10', empresa: 'redonhielo', imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: '1', importeImputado: 100 }], aCuenta: 25, numeroRecibo: 'RS-000191' })!
    expect(r.comprobantes.map((c) => [c.tipo, c.numero, c.saldoPendiente])).toEqual([['REC', 'RS-000191', -25]])
    expect(r.saldoTotal).toBe(-25)
    expect(r.porEmpresa.redonhielo).toMatchObject({ saldoTotal: -25, comprobantes: 1 })
  })

  it('descontarCobranza es idempotente y recalcula las ramas', () => {
    const doc = fusionarRamaEmpresa(
      fusionarRamaEmpresa(undefined, 'redonhielo', [comp('redonhielo', '1', 100)], { runId: 'r1', origen: 'sync' }),
      'rolito', [comp('rolito', '1', 30)], { runId: 'x1', origen: 'sync' },
    )
    const cob = { id: 'c9', empresa: 'rolito' as const, imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: '1', importeImputado: 30 }] }
    const r = descontarCobranza(doc, cob)!
    expect(r.saldoTotal).toBe(100)
    expect(r.porEmpresa.rolito).toMatchObject({ saldoTotal: 0, comprobantes: 0, runId: 'x1' })
    expect(r.porEmpresa.redonhielo?.saldoTotal).toBe(100)
    expect(descontarCobranza({ ...doc, cobranzasAplicadas: ['c9'] }, cob)).toBeNull()
  })
})

describe('empresas: identidad Tango por empresa', () => {
  it('absorbe los campos legacy como principal de Redonhielo', () => {
    const ids = tangoIdsDe({ idGva14Tango: 9414, codigoTango: 'NO.234' })
    expect(ids).toEqual({ redonhielo: [{ idGva14: 9414, codigo: 'NO.234' }] })
    expect(idGva14De({ idGva14Tango: 9414, codigoTango: 'NO.234' }, 'rolito')).toBeNull()
  })
  it('prioriza tangoIds y no duplica el legacy', () => {
    const perfil = { idGva14Tango: 1, codigoTango: 'A', tangoIds: { redonhielo: [{ idGva14: 1, codigo: 'A' }, { idGva14: 2, codigo: 'B' }], rolito: [{ idGva14: 77, codigo: 'A' }] } }
    expect(tangoIdsDe(perfil).redonhielo).toHaveLength(2)
    expect(codigoTangoDe(perfil, 'rolito')).toBe('A')
    expect(idGva14De(perfil, 'rolito')).toBe(77)
  })
  it('descarta entradas inválidas', () => {
    expect(tangoIdsDe({ tangoIds: { rolito: [{ idGva14: 'x', codigo: 'A' }, { idGva14: 3 }] } })).toEqual({})
  })
  it('agregarTangoId reordena como principal sin duplicar', () => {
    expect(agregarTangoId([{ idGva14: 1, codigo: 'A' }], { idGva14: 2, codigo: 'B' })).toEqual([{ idGva14: 1, codigo: 'A' }, { idGva14: 2, codigo: 'B' }])
    expect(agregarTangoId([{ idGva14: 1, codigo: 'A' }, { idGva14: 2, codigo: 'B' }], { idGva14: 2, codigo: 'B2' }, { principal: true })).toEqual([{ idGva14: 2, codigo: 'B2' }, { idGva14: 1, codigo: 'A' }])
  })
})

describe('cuitValido', () => {
  it('acepta CUIT reales y rechaza rellenos', async () => {
    const { cuitValido } = await import('./cuit')
    expect(cuitValido('30-52604779-2')).toBe(true)
    expect(cuitValido('20104334955')).toBe(true)
    expect(cuitValido('30526047793')).toBe(false)
    expect(cuitValido('00000000000')).toBe(false)
    expect(cuitValido('11111111111')).toBe(false)
    expect(cuitValido('1234')).toBe(false)
  })
})
