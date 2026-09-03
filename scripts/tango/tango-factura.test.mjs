import { describe, it, expect } from 'vitest'
import {
  armarComprobanteFacturador, documentoDeVenta, itemsDeVenta, percepcionesPorItem,
  numeroComprobanteTango, fechaArcaAIso, interpretarRespuestaFacturador,
} from './tango-factura.mjs'

// Venta real de prueba del 2026-09-02 (factura A 1104-00000001, $1 + IVA + 6% IIBB)
const ventaReal = {
  canal: 'contado', formaPago: 'contado_efectivo', total: 1, camionId: 'cam1', clienteId: 'cli1',
  choferNombre: 'Pedro', firmanteNombre: 'Juan', clienteCodigoTango: 'FC.280',
  items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo bolsa 10kg', cantidad: 1, precioUnitario: 1 }],
  factura: { cbteTipo: 1, numero: 1, puntoVenta: 1104, estado: 'emitida', cae: '86351147350772', caeFchVto: '20260912',
             importes: { fecha: '20260902', neto: 1, total: 1.27, iva: 0.21, tributos: 0.06 } },
  fecha: { seconds: 1788381042 },
}
const cfg = {
  talonarios: { A: 20, B: 21, X: 30 }, condicionVenta: 1, listaPrecio: { contado: 2, promo: 3 }, contracuenta: 20,
  vendedor: '3', codigoTasaIva21: 1, cuentas: { contado_efectivo: '1', contado_transferencia: '5' },
  codigoAlicuotaPercepcionIIBB: 12,
}
const mapeos = { codigoArticulo: (id) => ({ bolsa_10kg: 'HB10', barra: 'BARRA' })[id] ?? null, codigoDeposito: '05', etiquetaCamion: '05 AF313WU' }
const item = { origenColeccion: 'ventasCamion', origenId: 'v1', empresa: 'redonhielo' }

describe('formatos', () => {
  it('número Tango = letra + pto vta 5 + nro 8', () => {
    expect(numeroComprobanteTango('A', 1104, 1)).toBe('A0110400000001')
    expect(numeroComprobanteTango('B', 1, 140)).toBe('B0000100000140')
  })
  it('fecha ARCA AAAAMMDD → yyyy-mm-dd', () => {
    expect(fechaArcaAIso('20260912')).toBe('2026-09-12')
    expect(fechaArcaAIso('2026-09-12T10:00:00Z')).toBe('2026-09-12')
    expect(fechaArcaAIso(null)).toBeNull()
  })
  it('documentoDeVenta: fiscal con CAE, X interna, o nada', () => {
    expect(documentoDeVenta(ventaReal)).toMatchObject({ letra: 'A', puntoVenta: 1104, numero: 1, cae: '86351147350772', fiscal: true })
    expect(documentoDeVenta({ comprobanteInterno: { tipo: 'facturaX', puntoVenta: 3, numero: 7 } })).toMatchObject({ letra: 'X', numero: 7, fiscal: false })
    expect(documentoDeVenta({ comprobanteInterno: { tipo: 'remito', puntoVenta: 2, numero: 7 } })).toBeNull()
    expect(documentoDeVenta({ factura: { estado: 'emitida', numero: 1, cbteTipo: 99, importes: {} } }).error).toMatch(/cbteTipo 99/)
  })
})

describe('itemsDeVenta', () => {
  it('reconstruye base/IVA/precio con IVA desde precios netos y cierra contra ARCA', () => {
    const r = itemsDeVenta(ventaReal, { codigoArticulo: mapeos.codigoArticulo, codigoTasaIva: 1, codigoDeposito: '05', totales: { neto: 1, iva: 0.21 } })
    expect(r.faltantes).toEqual([])
    expect(r.items[0]).toMatchObject({ codigo: 'HB10', cantidad: 1, precio: 1.21, importe: 1.21, importeSinImpuestos: 1, importeIva: 0.21, codigoTasaIva: 1, codigoDeposito: '05', descargaStock: true })
  })
  it('ajusta el redondeo al último ítem con importe', () => {
    const venta = { items: [
      { productoId: 'bolsa_10kg', cantidad: 3, precioUnitario: 33.33 },
      { productoId: 'barra', cantidad: 1, precioUnitario: 0.01 },
    ] }
    // ARCA recibió neto 100.00 / iva 21.00 (hipotético), los ítems suman 100.00 y 21.00 → sin ajuste;
    // forzamos un neto de 100.02 para ver el ajuste de 2 centavos.
    const r = itemsDeVenta(venta, { codigoArticulo: mapeos.codigoArticulo, codigoTasaIva: 1, totales: { neto: 100.02, iva: 21.01 } })
    expect(r.items.map((i) => i.importeSinImpuestos)).toEqual([99.99, 0.03])
    expect(r.items.reduce((s, i) => s + i.importeIva, 0)).toBeCloseTo(21.01, 2)
  })
  it('rechaza si los ítems no cierran ni de cerca con ARCA', () => {
    const r = itemsDeVenta(ventaReal, { codigoArticulo: mapeos.codigoArticulo, codigoTasaIva: 1, totales: { neto: 500, iva: 105 } })
    expect(r.error).toMatch(/no cierran/)
  })
  it('precios con IVA incluido: base = precio / 1.21', () => {
    const r = itemsDeVenta({ items: [{ productoId: 'barra', cantidad: 1, precioUnitario: 121 }] }, { codigoArticulo: mapeos.codigoArticulo, codigoTasaIva: 1, preciosIncluyenIva: true })
    expect(r.items[0]).toMatchObject({ precio: 121, importeSinImpuestos: 100, importeIva: 21, importe: 121 })
  })
  it('cambios a precio 0 y artículo base; faltantes se reportan', () => {
    const r = itemsDeVenta({ items: [{ productoId: 'agua_6l', cantidad: 1, precioUnitario: 10 }], cambios: [{ productoId: 'cambio_barra', cantidad: 2 }] }, { codigoArticulo: mapeos.codigoArticulo, codigoTasaIva: 1 })
    expect(r.faltantes).toEqual(['agua_6l'])
    expect(r.items[0]).toMatchObject({ codigo: 'BARRA', cantidad: 2, precio: 0, importe: 0 })
  })
})

describe('percepcionesPorItem', () => {
  it('reparte la percepción proporcional al neto y cierra exacto', () => {
    const items = [{ _base: 70 }, { _base: 30 }, { _base: 0 }]
    const p = percepcionesPorItem(items, 6.01, { codigoAlicuotaPercepcionIIBB: 12 })
    expect(p[0][0]).toMatchObject({ codigoAlicuota: 12, porcentaje: 6.01, base: 70, importe: 4.21 })
    expect(p[1][0].importe).toBe(1.8)
    expect(p[2]).toEqual([])
    expect(p[0][0].importe + p[1][0].importe).toBeCloseTo(6.01, 2)
  })
  it('sin tributos no hay percepciones', () => {
    expect(percepcionesPorItem([{ _base: 10 }], 0, {})).toEqual([[]])
  })
})

describe('armarComprobanteFacturador', () => {
  it('factura A real: CAE externo, importes de ARCA, percepción IIBB, pago efectivo', () => {
    const r = armarComprobanteFacturador(ventaReal, item, cfg, mapeos)
    expect(r.error).toBeUndefined()
    expect(r.fiscal).toBe(true)
    expect(r.comprobante).toMatchObject({
      codigoTipoComprobante: 'FAC', numeroComprobante: 'A0110400000001', codigoTalonario: 20,
      cAE: '86351147350772', fechaVtoCAE: '2026-09-12', codigoCliente: 'FC.280',
      codigoCondicionDeVenta: 1, fechaComprobante: '2026-09-02', codigoListaPrecio: 2,
      codigoContracuenta: 20, codigoDeposito: '05', codigoVendedor: '3',
      leyenda1: 'ROLITO:VC:v1', total: 1.27, totalSinImpuestos: 1, totalIva: 0.21, subtotal: 1.27, subtotalSinImpuestos: 1,
    })
    expect(r.comprobante.items).toHaveLength(1)
    expect(r.comprobante.items[0].percepciones).toEqual([{ codigoAlicuota: 12, codigoPercepcion: '', porcentaje: 6, base: 1, importe: 0.06 }])
    expect(r.comprobante.items[0]).not.toHaveProperty('_base')
    expect(r.comprobante.pagos).toEqual([{ tipo: 'Efectivo', codigoDeCuenta: '1', monto: 1.27 }])
    expect(r.comprobante).not.toHaveProperty('cuotasCuentaCorriente')
  })
  it('transferencia usa su cuenta; cuenta corriente va con cuota', () => {
    const t = armarComprobanteFacturador({ ...ventaReal, formaPago: 'contado_transferencia' }, item, cfg, mapeos)
    expect(t.comprobante.pagos[0]).toMatchObject({ codigoDeCuenta: '5' })
    const cc = armarComprobanteFacturador({ ...ventaReal, formaPago: 'cuenta_corriente' }, item, cfg, mapeos)
    expect(cc.comprobante.cuotasCuentaCorriente).toEqual([{ fechaVencimiento: '2026-09-02', importe: 1.27 }])
    expect(cc.comprobante).not.toHaveProperty('pagos')
  })
  it('factura X de promo: sin CAE, talonario X, totales derivados de los ítems', () => {
    const promo = { ...ventaReal, canal: 'promo', factura: undefined, comprobanteInterno: { tipo: 'facturaX', puntoVenta: 3, numero: 9 },
                    items: [{ productoId: 'barra', nombre: 'Barra', cantidad: 2, precioUnitario: 1000 }] }
    const r = armarComprobanteFacturador(promo, { ...item, empresa: 'rolito' }, cfg, mapeos)
    expect(r.error).toBeUndefined()
    expect(r.fiscal).toBe(false)
    expect(r.comprobante).toMatchObject({ numeroComprobante: 'X0000300000009', codigoTalonario: 30, codigoListaPrecio: 3, total: 2420, totalSinImpuestos: 2000, totalIva: 420 })
    expect(r.comprobante).not.toHaveProperty('cAE')
  })
  it('errores de config claros y sin inventar', () => {
    expect(armarComprobanteFacturador(ventaReal, item, { ...cfg, talonarios: {} }, mapeos).error).toMatch(/talonarios\.A/)
    expect(armarComprobanteFacturador({ ...ventaReal, clienteCodigoTango: undefined }, item, cfg, mapeos).error).toMatch(/clienteCodigoTango/)
    expect(armarComprobanteFacturador(ventaReal, item, { ...cfg, cuentas: {} }, mapeos).error).toMatch(/cuentas\.contado_efectivo/)
    expect(armarComprobanteFacturador(ventaReal, item, { ...cfg, codigoAlicuotaPercepcionIIBB: undefined }, mapeos).error).toMatch(/codigoAlicuotaPercepcionIIBB/)
    expect(armarComprobanteFacturador(ventaReal, item, cfg, { ...mapeos, codigoArticulo: () => null }).error).toMatch(/bolsa_10kg/)
    expect(armarComprobanteFacturador({ ...ventaReal, factura: undefined }, item, cfg, mapeos).error).toMatch(/nada que registrar/)
  })
})

describe('interpretarRespuestaFacturador', () => {
  it('OK', () => {
    const r = interpretarRespuestaFacturador({ Message: 'ok', Comprobantes: [{ numeroComprobante: 'FAC A0110400000001', estado: 'Ok', mensaje: '' }], Succeeded: true }, 'A0110400000001')
    expect(r).toMatchObject({ ok: true, yaExistia: false, numeroComprobante: 'FAC A0110400000001' })
  })
  it('duplicado 51016 se toma como ya registrado', () => {
    const r = interpretarRespuestaFacturador({ Message: 'Hubo errores', Comprobantes: [{ numeroComprobante: 'FAC A0110400000001', estado: 'Error', mensaje: '(51016) Ya existe el número de comprobante A 01104-00000001.' }], Succeeded: false }, 'A0110400000001')
    expect(r).toMatchObject({ ok: true, yaExistia: true })
  })
  it('otro error no es ok', () => {
    const r = interpretarRespuestaFacturador({ Message: 'Hubo errores', Comprobantes: [{ numeroComprobante: 'FAC A0110400000001', estado: 'Error', mensaje: '(12345) Talonario inexistente' }], Succeeded: false }, 'A0110400000001')
    expect(r.ok).toBe(false)
    expect(r.mensaje).toMatch(/Talonario/)
  })
})
