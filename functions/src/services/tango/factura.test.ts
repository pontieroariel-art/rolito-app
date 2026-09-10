import { describe, it, expect } from 'vitest'
import {
  armarComprobanteFacturador, armarNotaCreditoFacturador, documentoDeVenta, itemsDeVenta, percepcionesPorItem,
  numeroComprobanteTango, fechaArcaAIso, interpretarRespuestaFacturador, type ConfigFacturadorEmpresa,
} from './factura'
import type { PayloadVenta } from './pedido'

// Venta real del 2026-09-02 (factura A 1104-00000001, $1 + IVA + 6% IIBB)
const ventaReal: PayloadVenta = {
  canal: 'contado', formaPago: 'contado_efectivo', total: 1, camionId: 'cam1', choferId: 'ch1', clienteId: 'cli1',
  choferNombre: 'Pedro', firmanteNombre: 'Juan', clienteCodigoTango: 'FC.280',
  items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo bolsa 10kg', cantidad: 1, precioUnitario: 1 }],
  factura: { cbteTipo: 1, numero: 1, puntoVenta: 1104, estado: 'emitida', cae: '86351147350772', caeFchVto: '20260912',
             importes: { fecha: '20260902', neto: 1, total: 1.27, iva: 0.21, tributos: 0.06 } },
  fecha: { seconds: 1788381042 },
}
const cfg: ConfigFacturadorEmpresa = {
  talonarios: { A: 20, B: 21, X: 30 }, condicionVenta: 1, listaPrecio: { contado: 2, promo: 3 }, contracuenta: 20,
  vendedor: '3', codigoTasaIva21: 1, cuentas: { contado_efectivo: '1', contado_transferencia: '5' },
  codigoAlicuotaPercepcionIIBB: 12,
}
const mapeos = { codigoArticulo: (id: string) => ({ bolsa_10kg: 'PTHIBOLROLI0010', barra: 'PTHIBARRA' } as Record<string, string>)[id] ?? null, codigoDeposito: '03', etiquetaCamion: '03 SERGIO ALVAREZ' }
const item = { origenColeccion: 'ventasCamion', origenId: 'v1', empresa: 'redonhielo' }

describe('formatos', () => {
  it('número Tango = letra + pto vta 5 + nro 8', () => {
    expect(numeroComprobanteTango('A', 1104, 1)).toBe('A0110400000001')
  })
  it('fecha ARCA AAAAMMDD → yyyy-mm-dd', () => {
    expect(fechaArcaAIso('20260912')).toBe('2026-09-12')
    expect(fechaArcaAIso(null)).toBeNull()
  })
  it('documentoDeVenta: fiscal con CAE, X interna, o nada', () => {
    expect(documentoDeVenta(ventaReal)).toMatchObject({ letra: 'A', numero: 1, cae: '86351147350772', fiscal: true })
    expect(documentoDeVenta({ comprobanteInterno: { tipo: 'facturaX', puntoVenta: 3, numero: 7 } })).toMatchObject({ letra: 'X', fiscal: false })
    expect(documentoDeVenta({ comprobanteInterno: { tipo: 'remito', puntoVenta: 2, numero: 7 } })).toBeNull()
  })
})

describe('itemsDeVenta', () => {
  it('reconstruye base/IVA/precio con IVA y cierra contra ARCA', () => {
    const r = itemsDeVenta(ventaReal, { codigoArticulo: mapeos.codigoArticulo, codigoTasaIva: 1, codigoDeposito: '03', totales: { neto: 1, iva: 0.21 } })
    expect(r.items[0]).toMatchObject({ codigo: 'PTHIBOLROLI0010', precio: 1.21, importe: 1.21, importeSinImpuestos: 1, importeIva: 0.21, codigoDeposito: '03' })
  })
  it('ajusta el redondeo al último ítem con importe', () => {
    const venta = { items: [{ productoId: 'bolsa_10kg', cantidad: 3, precioUnitario: 33.33 }, { productoId: 'barra', cantidad: 1, precioUnitario: 0.01 }] }
    const r = itemsDeVenta(venta, { codigoArticulo: mapeos.codigoArticulo, codigoTasaIva: 1, totales: { neto: 100.02, iva: 21.01 } })
    expect(r.items.map((i) => i.importeSinImpuestos)).toEqual([99.99, 0.03])
  })
  it('rechaza si los ítems no cierran ni de cerca', () => {
    expect(itemsDeVenta(ventaReal, { codigoArticulo: mapeos.codigoArticulo, codigoTasaIva: 1, totales: { neto: 500, iva: 105 } }).error).toMatch(/no cierran/)
  })
})

describe('percepcionesPorItem', () => {
  it('reparte proporcional al neto y cierra exacto', () => {
    const p = percepcionesPorItem([{ _base: 70 }, { _base: 30 }, { _base: 0 }], 6.01, { codigoAlicuotaPercepcionIIBB: 12 })
    expect(p[0][0]).toMatchObject({ codigoAlicuota: 12, porcentaje: 6.01, base: 70, importe: 4.21 })
    expect(p[1][0].importe).toBe(1.8)
    expect(p[2]).toEqual([])
  })
})

describe('armarComprobanteFacturador', () => {
  it('factura A real: CAE externo, importes de ARCA, percepción, pago efectivo', () => {
    const r = armarComprobanteFacturador(ventaReal, item, cfg, mapeos)
    if (r.error !== undefined) throw new Error(r.error)
    expect(r.comprobante).toMatchObject({
      codigoTipoComprobante: 'FAC', numeroComprobante: 'A0110400000001', codigoTalonario: 20,
      cAE: '86351147350772', fechaVtoCAE: '2026-09-12', codigoCliente: 'FC.280', fechaComprobante: '2026-09-02',
      codigoListaPrecio: 2, codigoDeposito: '03', total: 1.27, totalSinImpuestos: 1, totalIva: 0.21,
    })
    const items = r.comprobante.items as Record<string, unknown>[]
    expect(items[0].percepciones).toEqual([{ codigoAlicuota: 12, codigoPercepcion: '', porcentaje: 6, base: 1, importe: 0.06 }])
    expect(items[0]).not.toHaveProperty('_base')
    expect(r.comprobante.pagos).toEqual([{ tipo: 'Efectivo', codigoDeCuenta: '1', monto: 1.27 }])
  })
  it('factura X de promo sin CAE con totales derivados', () => {
    const promo: PayloadVenta = { ...ventaReal, canal: 'promo', factura: undefined, comprobanteInterno: { tipo: 'facturaX', puntoVenta: 3, numero: 9 },
      items: [{ productoId: 'barra', nombre: 'Barra', cantidad: 2, precioUnitario: 1000 }] }
    // Tango no tiene factura X: entra con la letra según la categoría de IVA del cliente.
    expect(armarComprobanteFacturador(promo, { ...item, empresa: 'rolito' }, cfg, mapeos).error).toMatch(/letra/)
    const r = armarComprobanteFacturador(promo, { ...item, empresa: 'rolito' }, cfg, { ...mapeos, letraNoFiscal: 'B' })
    if (r.error !== undefined) throw new Error(r.error)
    expect(r.fiscal).toBe(false)
    expect(r.comprobante).toMatchObject({ numeroComprobante: 'B0000300000009', codigoTalonario: 21, codigoListaPrecio: 3, total: 2420, totalSinImpuestos: 2000 })
    expect(r.comprobante).not.toHaveProperty('cAE')
  })
  it('Rolito sin IVA: el precio de la app es el importe final, IVA 0 con tasa cero', () => {
    const promo: PayloadVenta = { ...ventaReal, canal: 'promo', factura: undefined, comprobanteInterno: { tipo: 'facturaX', puntoVenta: 1104, numero: 1 },
      items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo bolsa 10kg', cantidad: 1, precioUnitario: 1 }] }
    const r = armarComprobanteFacturador(promo, { ...item, empresa: 'rolito' }, { ...cfg, sinIva: true, codigoTasaIva21: undefined }, { ...mapeos, letraNoFiscal: 'A' })
    if (r.error !== undefined) throw new Error(r.error)
    expect(r.comprobante).toMatchObject({ numeroComprobante: 'A0110400000001', total: 1, totalSinImpuestos: 1, totalIva: 0, subtotal: 1 })
    expect((r.comprobante.items as Record<string, unknown>[])[0]).toMatchObject({ codigoTasaIva: 10, precio: 1, importe: 1, importeSinImpuestos: 1, importeIva: 0 })
    expect(r.comprobante.pagos).toEqual([{ tipo: 'Efectivo', codigoDeCuenta: '1', monto: 1 }])
  })
  it('quién vendió va en la leyenda 3 y en las observaciones: camión → chofer, ventanilla → caja y planta', () => {
    const camion = armarComprobanteFacturador(ventaReal, item, cfg, mapeos)
    if (camion.error !== undefined) throw new Error(camion.error)
    expect(camion.comprobante.leyenda3).toBe('Chofer Pedro - 03 SERGIO ALVAREZ')
    expect(camion.comprobante.observaciones).toContain('Venta desde el camión 03 SERGIO ALVAREZ por Pedro')
    // El vendedor del comprobante es el que pasa el writer (supervisor del cliente), no el chofer.
    expect(camion.comprobante.codigoVendedor).toBe('3')

    const ventanilla: PayloadVenta = { ...ventaReal, camionId: null, choferId: undefined, choferNombre: undefined, plantaId: 'torcuato', cajaId: 'caja1', cajaNombre: 'Nicolas Diaz' }
    const r = armarComprobanteFacturador(ventanilla, { ...item, origenColeccion: 'ventasVentanilla' }, { ...cfg, vendedor: 'MV' }, { ...mapeos, codigoDeposito: '01', etiquetaCamion: '01' })
    if (r.error !== undefined) throw new Error(r.error)
    expect(r.comprobante.leyenda1).toBe('ROLITO:VV:v1')
    expect(r.comprobante.leyenda3).toBe('Caja Nicolas Diaz - Torcuato')
    expect(r.comprobante.observaciones).toContain('Venta desde la ventanilla de Torcuato por Nicolas Diaz')
    expect(r.comprobante.codigoVendedor).toBe('MV')
  })
  it('errores de config claros', () => {
    expect(armarComprobanteFacturador(ventaReal, item, { ...cfg, talonarios: {} }, mapeos).error).toMatch(/talonarios\.A/)
    expect(armarComprobanteFacturador(ventaReal, item, { ...cfg, cuentas: {} }, mapeos).error).toMatch(/cuentas\.contado_efectivo/)
    expect(armarComprobanteFacturador(ventaReal, item, cfg, { ...mapeos, codigoArticulo: () => null }).error).toMatch(/bolsa_10kg/)
  })
})

describe('interpretarRespuestaFacturador', () => {
  it('OK, duplicado 51016 como ya registrado, otro error no ok', () => {
    expect(interpretarRespuestaFacturador({ Comprobantes: [{ numeroComprobante: 'FAC A0110400000001', estado: 'Ok', mensaje: '' }], Succeeded: true }, 'A0110400000001')).toMatchObject({ ok: true, yaExistia: false })
    expect(interpretarRespuestaFacturador({ Comprobantes: [{ numeroComprobante: 'FAC A0110400000001', estado: 'Error', mensaje: '(51016) Ya existe el número de comprobante' }], Succeeded: false }, 'A0110400000001')).toMatchObject({ ok: true, yaExistia: true })
    expect(interpretarRespuestaFacturador({ Comprobantes: [{ numeroComprobante: 'FAC A0110400000001', estado: 'Error', mensaje: '(12345) Talonario inexistente' }], Succeeded: false }, 'A0110400000001').ok).toBe(false)
  })
})

describe('Rolito sin stock y factura en $0 (decisión 2026-09-05)', () => {
  const promo: PayloadVenta = { ...ventaReal, canal: 'promo', factura: undefined, comprobanteInterno: { tipo: 'facturaX', puntoVenta: 3, numero: 9 },
    items: [{ productoId: 'barra', nombre: 'Barra', cantidad: 2, precioUnitario: 1000 }],
    cambios: [{ productoId: 'cambio_bolsa_10kg', nombre: 'Cambio bolsa 10', cantidad: 1, precioUnitario: 0 }] }
  const cfgRolito = { ...cfg, sinIva: true, codigoTasaIva21: undefined, descargaStock: false }

  it('con descargaStock false los ítems no descargan pero SÍ llevan depósito (el Facturador lo exige)', () => {
    const r = armarComprobanteFacturador(promo, { ...item, empresa: 'rolito' }, cfgRolito, { ...mapeos, letraNoFiscal: 'B' })
    if (r.error !== undefined) throw new Error(r.error)
    expect(r.comprobante).toMatchObject({ codigoDeposito: '03' })
    const items = r.comprobante.items as Record<string, unknown>[]
    expect(items).toHaveLength(1)                       // los cambios no van cuando hay renglones vendidos
    expect(items[0]).toMatchObject({ codigo: 'PTHIBARRA', descargaStock: false, codigoDeposito: '03' })
    expect(r.comprobante.total).toBe(2000)
    const rh = armarComprobanteFacturador(ventaReal, item, cfg, mapeos)
    if (rh.error !== undefined) throw new Error(rh.error)
    expect((rh.comprobante.items as Record<string, unknown>[])[0]).toMatchObject({ descargaStock: true, codigoDeposito: '03' })
  })
  it('promo de solo cambios: factura en $0 con los renglones de cambio (artículo CAMBIO*), sin pagos', () => {
    const soloCambio: PayloadVenta = { ...promo, total: 0, items: [], comprobanteInterno: { tipo: 'facturaX', puntoVenta: 3, numero: 10 } }
    const conCambio = { ...mapeos, codigoArticulo: (id: string) => ({ bolsa_10kg: 'PTHIBOLROLI0010', cambio_bolsa_10kg: 'CAMBIOBOL10' } as Record<string, string>)[id] ?? null, letraNoFiscal: 'B' as const }
    const r = armarComprobanteFacturador(soloCambio, { ...item, empresa: 'rolito' }, cfgRolito, conCambio)
    if (r.error !== undefined) throw new Error(r.error)
    const items = r.comprobante.items as Record<string, unknown>[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ codigo: 'CAMBIOBOL10', cantidad: 1, precio: 0, importe: 0, descargaStock: false })
    expect(r.comprobante).toMatchObject({ numeroComprobante: 'B0000300000010', total: 0, totalSinImpuestos: 0, totalIva: 0 })
    expect(r.comprobante).not.toHaveProperty('pagos')
    expect(r.comprobante).not.toHaveProperty('cuotasCuentaCorriente')
  })
  it('el cambio sin mapeo propio cae al artículo del producto', () => {
    const soloCambio: PayloadVenta = { ...promo, total: 0, items: [] }
    const r = armarComprobanteFacturador(soloCambio, { ...item, empresa: 'rolito' }, cfgRolito, { ...mapeos, letraNoFiscal: 'B' })
    if (r.error !== undefined) throw new Error(r.error)
    expect((r.comprobante.items as Record<string, unknown>[])[0]).toMatchObject({ codigo: 'PTHIBOLROLI0010', descargaStock: false })
  })
})

describe('armarNotaCreditoFacturador (anulación de ventanilla)', () => {
  const cfgNC: ConfigFacturadorEmpresa = { ...cfg, talonariosNC: { A: 1001, B: 1003 } }
  const ventaAnulada: PayloadVenta = {
    ...ventaReal, cajaId: 'u1', cajaNombre: 'Nicolas Diaz', plantaId: 'torcuato', camionId: undefined, choferId: undefined,
    notaCredito: { estado: 'emitida', cbteTipo: 3, puntoVenta: 1104, numero: 7, cae: '75999999999999', caeFchVto: '20260920',
      importes: { fecha: '20260909', neto: 1, iva: 0.21, tributos: 0.06, total: 1.27 },
      cbtesAsoc: [{ Tipo: 1, PtoVta: 1104, Nro: 1, Cuit: '30697668973', CbteFch: '20260902' }] },
    anulacion: { motivo: 'Cliente equivocado', nota: 'era la sucursal 2', solicitadoPor: 'Nicolas Diaz', resueltaPor: 'Yanina' },
  }
  const itemNC = { origenColeccion: 'anulacionesVentanilla', origenId: 'v1', empresa: 'redonhielo' }

  it('es la factura entera como N/C (código de Tango para nota de crédito), con su número/talonario/CAE y la referencia a la factura', () => {
    const r = armarNotaCreditoFacturador(ventaAnulada, itemNC, cfgNC, mapeos)
    if (r.error !== undefined) throw new Error(r.error)
    expect(r.comprobante).toMatchObject({
      codigoTipoComprobante: 'N/C', numeroComprobante: 'A0110400000007', codigoTalonario: 1001,
      cAE: '75999999999999', fechaVtoCAE: '2026-09-20', fechaComprobante: '2026-09-09',
      codigoTipoComprobanteDeReferencia: 'FAC', numeroDeComprobanteDeReferencia: 'A0110400000001', comprobanteCanceladoCompletamente: true,
      codigoMotivo: '4', codigoCliente: 'FC.280', total: 1.27, totalSinImpuestos: 1, totalIva: 0.21,
      leyenda1: 'ROLITO:NC:v1', leyenda4: 'Autorizo: Yanina',
    })
    expect(r.comprobante.pagos).toEqual([{ tipo: 'Efectivo', codigoDeCuenta: '1', monto: 1.27 }])
    expect((r.comprobante.items as unknown[]).length).toBe(1)
    expect(r.referencia).toBe('ROLITO:NC:v1')
  })

  it('exige talonario de NC, NC emitida con CAE y total igual al de la factura', () => {
    expect(armarNotaCreditoFacturador(ventaAnulada, itemNC, cfg, mapeos)).toMatchObject({ error: expect.stringMatching(/talonariosNC\.A/) })
    expect(armarNotaCreditoFacturador({ ...ventaAnulada, notaCredito: { ...ventaAnulada.notaCredito, cae: null } }, itemNC, cfgNC, mapeos)).toMatchObject({ error: expect.stringMatching(/emitida/) })
    expect(armarNotaCreditoFacturador({ ...ventaAnulada, notaCredito: { ...ventaAnulada.notaCredito, importes: { ...ventaAnulada.notaCredito!.importes!, total: 99 } } }, itemNC, cfgNC, mapeos)).toMatchObject({ error: expect.stringMatching(/no coincide/) })
  })
})
