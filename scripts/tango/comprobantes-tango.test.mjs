import { describe, expect, it } from 'vitest'
import {
  aPodar, actualizarCache, cbteTipoDe, claveFactura, diferencias, familiaDe, huella, mapearFacturas, mapearRemitos,
  parsearNumeroTango, relacionDeFilas, seccionesIndice, tipoCorto,
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
  // Los códigos son los que se relevaron en las dos empresas el 2026-09-13: cada una
  // inventó los suyos, y lo único que los clasifica es TCOMP_IN_V.
  it('clasifica por la clase interna de Tango, no por el código del comprobante', () => {
    expect(familiaDe('FC', 'FAC')).toBe('factura')
    expect(familiaDe('CC', 'NCB')).toBe('credito')
    expect(familiaDe('CC', 'C/E')).toBe('credito')
    expect(familiaDe('CC', 'CAR')).toBe('credito')
    expect(familiaDe('DC', 'D/B')).toBe('debito')
    expect(familiaDe('DC', 'DEB')).toBe('debito')
    expect(familiaDe('RC', 'REC')).toBe('recibo')
    expect(familiaDe(' cc ', 'NCT')).toBe('credito')
  })
  it('sin clase interna cae al código conocido, y si tampoco lo conoce dice "otro"', () => {
    expect(familiaDe(null, 'FAC')).toBe('factura')
    expect(familiaDe('', 'N/C')).toBe('credito')
    expect(familiaDe(undefined, 'N/D')).toBe('debito')
    expect(familiaDe(null, 'REC')).toBe('recibo')
    expect(familiaDe(null, 'CDP')).toBe('otro')
  })
  it('la huella es estable ante el orden de las claves', () => {
    expect(huella({ a: 1, b: { c: 2, d: 3 } })).toBe(huella({ b: { d: 3, c: 2 }, a: 1 }))
    expect(huella({ a: 1 })).not.toBe(huella({ a: 2 }))
  })
})

describe('mapearFacturas', () => {
  const facturas = [{
    ID_GVA12: 372383, T_COMP: 'FAC', N_COMP: 'A0010100282787', FECHA_EMIS: f(2026, 9, 2), IMPORTE: 84216, IMPORTE_GR: 69600, IMPORTE_EX: 0, IMPORTE_IV: 14616, IMPORTE_IN: 0,
    TCOMP_IN_V: 'FC', ESTADO: 'PEN', COD_CLIENT: 'PA.003', CAT_IVA: 'RI', COND_VTA: 2, COD_VENDED: 'MS', CAICAE: '86351131069060', CAICAE_VTO: f(2026, 9, 12), FECHA_ANU: f(1800, 1, 1),
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
    expect(r).toMatchObject({ tipo: 'FAC', familia: 'factura', numero: 'A0010100282787', fecha: '2026-09-02', importe: 84216, estado: 'PEN', idGva12: 372383, remitos: ['R0000100482053'] })
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

  it('la orden de compra sale de la leyenda que la nombra, o de la columna propia si la empresa la usa (2026-09-21)', () => {
    const base = { ...facturas[0], LEYENDA_1: 'ROLITO:VC:abc', LEYENDA_2: '  ', LEYENDA_5: 'O. compra: 4521-B' }
    const conLeyenda = mapearFacturas({ empresa: 'redonhielo', facturas: [base], renglones: [], remitosPorFactura: {}, clientes: {}, condiciones: {}, vendedores: {} })
    expect(conLeyenda.detalles[0].doc.ordenCompra).toBe('4521-B')
    expect(conLeyenda.detalles[0].doc.leyendas).toEqual(['ROLITO:VC:abc', 'O. compra: 4521-B'])
    // Como la tipea la oficina.
    for (const l of ['OC 778', 'Orden de compra Nº 778', 'O/C: 778', 'oc-778']) {
      const r = mapearFacturas({ empresa: 'redonhielo', facturas: [{ ...facturas[0], LEYENDA_3: l }], renglones: [], remitosPorFactura: {}, clientes: {}, condiciones: {}, vendedores: {} })
      expect(r.detalles[0].doc.ordenCompra, l).toBe('778')
    }
    // Columna propia: va primero, y la de la leyenda se suma (pueden ser varias).
    const conColumna = mapearFacturas({ empresa: 'redonhielo', facturas: [{ ...base, NRO_OC: ' 9001 ' }], renglones: [], remitosPorFactura: {}, clientes: {}, condiciones: {}, vendedores: {}, columnaOrdenCompra: 'NRO_OC' })
    expect(conColumna.detalles[0].doc.ordenCompra).toBe('9001, 4521-B')
    // Sin nada, no se escribe el campo.
    const sinNada = mapearFacturas({ empresa: 'redonhielo', facturas: [facturas[0]], renglones: [], remitosPorFactura: {}, clientes: {}, condiciones: {}, vendedores: {} })
    expect(sinNada.detalles[0].doc.ordenCompra).toBeUndefined()
    expect(sinNada.detalles[0].doc.leyendas).toBeUndefined()
  })

  it('la oficina tipea la O/C como renglón de texto (GVA45) bajo el último artículo, a veces varias (2026-09-21)', () => {
    // Traza real de A0010100283346: GVA53 tiene el hueco del renglón 2 sin artículo ni importe; el texto está en GVA45.
    const hueco = { T_COMP: 'FAC', N_COMP: 'A0010100282787', N_RENGL_V: 3, COD_ARTICU: '', DESCRIPCIO: null, CANTIDAD: 0, PRECIO_NET: 0, PORC_DTO: 0, PORC_IVA: 0, IMP_NETO_P: 0 }
    const textos = [
      { T_COMP: 'FAC', N_COMP: 'A0010100282787', DESC: 'OC4501977102', ORDEN: 1 },
      { T_COMP: 'FAC', N_COMP: 'A0010100282787', DESC: 'OC 4501977103, 4501977104', ORDEN: 2 },
      { T_COMP: 'FAC', N_COMP: 'OTRA', DESC: 'OC 999', ORDEN: 1 },
    ]
    const { detalles } = mapearFacturas({ empresa: 'redonhielo', facturas, renglones: [...renglones, hueco], remitosPorFactura: porFactura, clientes, condiciones, vendedores, textos })
    const d = detalles[0].doc
    expect(d.renglones.map((x) => x.codigo)).toEqual(['PTHIBOLROLI0003', 'CAMBIOHIELO3KG'])   // el hueco no es mercadería
    expect(d.notas).toEqual(['OC4501977102', 'OC 4501977103, 4501977104'])
    expect(d.ordenCompra).toBe('4501977102, 4501977103, 4501977104')
    // Observaciones de cabecera también cuentan, y no se repite una O/C ya vista.
    const conObs = mapearFacturas({ empresa: 'redonhielo', facturas: [{ ...facturas[0], DESCRIPCION_FACTURA: 'Entrega según OC 4501977102', OBSERVAC: 'orden de compra 77' }], renglones: [], remitosPorFactura: {}, clientes: {}, condiciones: {}, vendedores: {}, textos: textos.slice(0, 1) })
    expect(conObs.detalles[0].doc.ordenCompra).toBe('4501977102, 77')
    expect(conObs.detalles[0].doc.observaciones).toEqual(['Entrega según OC 4501977102', 'orden de compra 77'])
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

  it('la orden de compra del remito sale de la leyenda 4 que escribe la app (columnas LEYENDA1..5, sin guión) (2026-09-21)', () => {
    const { detalles } = mapearRemitos({
      empresa: 'redonhielo',
      remitos: [{ ID_STA14: 1, N_COMP: 'R0110500001101', FECHA_MOV: f(2026, 9, 21), ESTADO_MOV: 'P', COD_PRO_CL: 'PA.003', TALONARIO: 15, USUARIO: 'GALLO', FECHA_ANU: f(1800, 1, 1),
        LEYENDA1: 'ROLITO:VC:6kaksW9E91XS17bmcs3k', LEYENDA2: 'Remito app 01105-00001101 - cuenta_corriente', LEYENDA3: 'Chofer Gallo Braian Agustin - Torcuato', LEYENDA4: 'O. compra: 6736', LEYENDA5: '' }],
      renglones: [], facturasPorRemito: {}, talonarios: {}, clientes, condiciones: {},
    })
    expect(detalles[0].doc.ordenCompra).toBe('6736')
    expect(detalles[0].doc.leyendas).toHaveLength(4)
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

describe('seccionesIndice (lo que va en el set con merge)', () => {
  const BORRAR = Symbol('deleteField')
  const borrar = () => BORRAR

  it('omite la sección que no tiene cambios ni poda: un {} con merge borraría el mapa entero', () => {
    const soloRemito = seccionesIndice({ facturas: {}, remitos: { R1: { fecha: '2026-09-14', h: 'c' } } }, undefined, borrar)
    expect(soloRemito).toEqual({ remitos: { R1: { fecha: '2026-09-14', h: 'c' } } })
    expect('facturas' in soloRemito).toBe(false)
    expect(seccionesIndice(undefined, undefined, borrar)).toEqual({})
  })

  it('las podadas van marcadas para borrar junto con los cambios', () => {
    const r = seccionesIndice({ facturas: { FAC_2: { h: 'b' } }, remitos: {} }, { facturas: ['FAC_0'], remitos: ['R0'] }, borrar)
    expect(r).toEqual({ facturas: { FAC_2: { h: 'b' }, FAC_0: BORRAR }, remitos: { R0: BORRAR } })
  })
})
