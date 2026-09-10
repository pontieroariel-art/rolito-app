import { describe, expect, it } from 'vitest'
import {
  aPodar, actualizarCache, cbteTipoDe, claveFactura, diferencias, huella, mapearFacturas, mapearRemitos,
  parsearNumeroTango, relacionDeFilas, tipoCorto,
} from './comprobantes-tango.mjs'

const f = (y, m, d) => new Date(y, m - 1, d)

const clientes = { 'PA.003': { COD_GVA14: 'PA.003', RAZON_SOCI: 'ALGAR S.R.L.', CUIT: '30-66178840-9', DOMICILIO: 'Calle 1', LOCALIDAD: 'SAN MIGUEL', C_POSTAL: '1663' } }
const condiciones = { '2': 'CTA CTE 7 DIAS' }
const vendedores = { MS: 'MARTIN SOSA' }

describe('números y tipos', () => {
  it('parsea el número de Tango y mapea el tipo de ARCA', () => {
    expect(parsearNumeroTango('A0010100282787')).toEqual({ letra: 'A', puntoVenta: 101, nro: 282787 })
    expect(parsearNumeroTango('R0110500000322')).toEqual({ letra: 'R', puntoVenta: 1105, nro: 322 })
    expect(parsearNumeroTango('nada')).toBeNull()
    expect(tipoCorto('N/C')).toBe('NC')
    expect(claveFactura('N/C', 'a0010100000001')).toBe('NC_A0010100000001')
    expect(cbteTipoDe('FAC', 'A')).toBe(1); expect(cbteTipoDe('N/C', 'B')).toBe(8); expect(cbteTipoDe('FAC', 'R')).toBeNull()
  })
  it('la huella es estable ante el orden de las claves', () => {
    expect(huella({ a: 1, b: { c: 2, d: 3 } })).toBe(huella({ b: { d: 3, c: 2 }, a: 1 }))
    expect(huella({ a: 1 })).not.toBe(huella({ a: 2 }))
  })
})

describe('mapearFacturas', () => {
  const facturas = [{
    ID_GVA12: 372383, T_COMP: 'FAC', N_COMP: 'A0010100282787', FECHA_EMIS: f(2026, 9, 2), IMPORTE: 84216, IMPORTE_GR: 69600, IMPORTE_EX: 0, IMPORTE_IV: 14616, IMPORTE_IN: 0,
    ESTADO: 'PEN', COD_CLIENT: 'PA.003', CAT_IVA: 'RI', COND_VTA: 2, COD_VENDED: 'MS', CAICAE: '86351131069060', CAICAE_VTO: f(2026, 9, 12), FECHA_ANU: f(1800, 1, 1),
  }]
  const renglones = [
    { T_COMP: 'FAC', N_COMP: 'A0010100282787', N_RENGL_V: 2, COD_ARTICU: 'CAMBIOHIELO3KG', DESCRIPCIO: 'CAMBIO', CANTIDAD: 1, PRECIO_NET: 0, PORC_DTO: 0, PORC_IVA: 0, IMP_NETO_P: 0 },
    { T_COMP: 'FAC', N_COMP: 'A0010100282787', N_RENGL_V: 1, COD_ARTICU: 'PTHIBOLROLI0003', DESCRIPCIO: 'HIELO EN BOLSA ROLITO 3 KG', CANTIDAD: 20, PRECIO_NET: 3480, PORC_DTO: 0, PORC_IVA: 21, IMP_NETO_P: 69600 },
  ]
  const { porFactura, porRemito } = relacionDeFilas([{ T_COMP_V: 'FAC', N_COMP: 'A0010100282787', REMITO: 'R0000100482053' }])

  it('arma el resumen por código y el detalle con CAE, cliente, renglones ordenados y remitos', () => {
    const { resumen, detalles } = mapearFacturas({ empresa: 'redonhielo', facturas, renglones, remitosPorFactura: porFactura, clientes, condiciones, vendedores })
    expect(Object.keys(resumen)).toEqual(['PA.003'])
    const r = resumen['PA.003'].FAC_A0010100282787
    expect(r).toMatchObject({ tipo: 'FAC', numero: 'A0010100282787', fecha: '2026-09-02', importe: 84216, estado: 'PEN', idGva12: 372383, remitos: ['R0000100482053'] })
    expect(typeof r.h).toBe('string')
    expect(detalles).toHaveLength(1)
    const d = detalles[0]
    expect(d.id).toBe('redonhielo_FAC_A0010100282787')
    expect(d.doc).toMatchObject({
      letra: 'A', puntoVenta: 101, nro: 282787, cbteTipo: 1, cae: '86351131069060', caeVto: '2026-09-12', estado: 'PEN',
      cliente: { razonSocial: 'ALGAR S.R.L.', cuit: '30-66178840-9', condicionIva: 'IVA Responsable Inscripto', condicionVenta: 'CTA CTE 7 DIAS', vendedor: 'MARTIN SOSA', cp: '1663' },
      totales: { gravado: 69600, iva: 14616, ivaAlic: 21, total: 84216, otros: 0 },
      remitos: ['R0000100482053'],
    })
    expect(d.doc.renglones.map((x) => x.codigo)).toEqual(['PTHIBOLROLI0003', 'CAMBIOHIELO3KG'])
    expect(d.doc.fechaAnulacion).toBeUndefined()
    expect(porRemito).toEqual({ R0000100482053: ['A0010100282787'] })
  })

  it('sin CAE queda vacío; la diferencia entre el total y los componentes va a "otros"', () => {
    const { detalles } = mapearFacturas({ empresa: 'redonhielo', facturas: [{ ...facturas[0], CAICAE: null, IMPORTE: 85000 }], renglones: [], remitosPorFactura: {}, clientes: {}, condiciones: {}, vendedores: {} })
    expect(detalles[0].doc.cae).toBe(''); expect(detalles[0].doc.caeVto).toBe('')
    expect(detalles[0].doc.totales.otros).toBe(784)
    expect(detalles[0].doc.cliente.razonSocial).toBe('')
    expect(detalles[0].doc.cliente.vendedor).toBe('MS')
  })
})

describe('mapearRemitos', () => {
  it('arma el remito con su talonario (CAI) y las facturas que lo absorbieron', () => {
    const { resumen, detalles } = mapearRemitos({
      empresa: 'redonhielo',
      remitos: [{ ID_STA14: 890223, N_COMP: 'R0000100482053', FECHA_MOV: f(2026, 8, 27), ESTADO_MOV: 'F', COD_PRO_CL: 'PA.003', TALONARIO: 15, USUARIO: 'SUPERVISOR', FECHA_ANU: f(1800, 1, 1) }],
      renglones: [{ ID_STA14: 890223, N_RENGL_S: 1, COD_ARTICU: 'PTHIBOLROLI0003', DESCRIPCIO: 'HIELO EN BOLSA ROLITO 3 KG', CANTIDAD: 20 }],
      facturasPorRemito: { R0000100482053: ['A0010100282787'] },
      talonarios: { '15': { CAI: '52273219324517', FECHA_VTO: f(2027, 7, 3), DESCRIP: 'RTO DON TORCUATO' } },
      clientes, condiciones: {},
    })
    expect(resumen['PA.003'].R0000100482053).toMatchObject({ fecha: '2026-08-27', estado: 'F', bultos: 20, idSta14: 890223, facturas: ['A0010100282787'] })
    expect(detalles[0].id).toBe('redonhielo_REM_R0000100482053')
    expect(detalles[0].doc).toMatchObject({
      tipo: 'REM', numero: 'R0000100482053', estado: 'F', usuario: 'SUPERVISOR', bultos: 20,
      talonario: { numero: 15, cai: '52273219324517', vencimiento: '2027-07-03', descripcion: 'RTO DON TORCUATO' },
      cliente: { razonSocial: 'ALGAR S.R.L.' },
      renglones: [{ codigo: 'PTHIBOLROLI0003', descripcion: 'HIELO EN BOLSA ROLITO 3 KG', cantidad: 20 }],
    })
  })
})

describe('diferencias, poda y cache', () => {
  const resumenF = { 'PA.003': { FAC_1: { tipo: 'FAC', numero: '1', fecha: '2026-09-02', importe: 1, estado: 'PEN', h: 'aaa' }, FAC_2: { tipo: 'FAC', numero: '2', fecha: '2026-08-01', importe: 1, estado: 'CAN', h: 'bbb' } } }
  const resumenR = { 'PA.003': { R1: { fecha: '2026-08-27', estado: 'F', bultos: 1, h: 'ccc' } } }
  const detalles = [{ id: 'x_FAC_1', doc: {}, h: 'aaa' }, { id: 'x_FAC_2', doc: {}, h: 'bbb' }, { id: 'x_REM_R1', doc: {}, h: 'ccc' }]

  it('sin cache todo es nuevo; con cache solo lo que cambió de huella', () => {
    const todo = diferencias({}, resumenF, resumenR, detalles)
    expect(Object.keys(todo.porCodigo['PA.003'].facturas)).toEqual(['FAC_1', 'FAC_2'])
    expect(todo.detallesAEscribir.map((d) => d.id)).toEqual(['x_FAC_1', 'x_FAC_2', 'x_REM_R1'])

    const cache = { 'PA.003': { facturas: { FAC_1: { h: 'aaa', fecha: '2026-09-02' }, FAC_2: { h: 'viejo', fecha: '2026-08-01' } }, remitos: { R1: { h: 'ccc', fecha: '2026-08-27' } } } }
    const parcial = diferencias(cache, resumenF, resumenR, detalles)
    expect(Object.keys(parcial.porCodigo['PA.003'].facturas)).toEqual(['FAC_2'])
    expect(Object.keys(parcial.porCodigo['PA.003'].remitos)).toEqual([])
    expect(parcial.detallesAEscribir.map((d) => d.id)).toEqual(['x_FAC_2'])
  })

  it('poda por fecha y actualiza el cache', () => {
    const cache = { 'PA.003': { facturas: { FAC_0: { h: 'z', fecha: '2025-06-01' }, FAC_1: { h: 'aaa', fecha: '2026-09-02' } }, remitos: { R0: { h: 'y', fecha: '2025-05-01' } } } }
    const podados = aPodar(cache, '2025-08-09')
    expect(podados).toEqual({ 'PA.003': { facturas: ['FAC_0'], remitos: ['R0'] } })
    const nuevo = actualizarCache(cache, { 'PA.003': { facturas: { FAC_2: { h: 'bbb', fecha: '2026-08-01', importe: 9 } }, remitos: {} } }, podados)
    expect(nuevo).toEqual({ 'PA.003': { facturas: { FAC_1: { h: 'aaa', fecha: '2026-09-02' }, FAC_2: { h: 'bbb', fecha: '2026-08-01' } }, remitos: {} } })
    expect(cache['PA.003'].facturas.FAC_0).toBeDefined()   // no muta el original
  })
})
