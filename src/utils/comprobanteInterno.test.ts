import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { armarFacturaX, armarRemito, tipoComprobanteInterno } from './comprobanteInterno'
import type { VentaCamion } from '@/types'

const base = (extra: Partial<VentaCamion> = {}): VentaCamion => ({
  id: 'venta123456',
  canal: 'contado',
  camionId: 'c1',
  choferId: 'ch1',
  choferNombre: 'Pedro',
  clienteId: 'cli1',
  clienteNombre: 'Kiosco La Esquina',
  items: [{ productoId: 'bolsa_3kg', nombre: 'Hielo bolsa 3kg', cantidad: 10, precioUnitario: 1000 }],
  total: 10000,
  formaPago: 'cuenta_corriente',
  fecha: Timestamp.fromDate(new Date('2026-09-03T10:00:00-03:00')),
  ...extra,
})

describe('tipoComprobanteInterno', () => {
  it('contado efectivo/transferencia va por ARCA: sin comprobante interno', () => {
    expect(tipoComprobanteInterno(base({ formaPago: 'contado_efectivo' }))).toBeNull()
    expect(tipoComprobanteInterno(base({ formaPago: 'contado_transferencia' }))).toBeNull()
  })

  it('contado en cuenta corriente, o solo cambios, sale por remito de Redonhielo', () => {
    expect(tipoComprobanteInterno(base())).toBe('remito')
    expect(tipoComprobanteInterno(base({ formaPago: 'contado_efectivo', total: 0, items: [] }))).toBe('remito')
  })

  it('promo sale por factura X cobrada o en cuenta corriente; solo la operación en $0 va por remito de Rolito', () => {
    expect(tipoComprobanteInterno(base({ canal: 'promo', formaPago: 'contado_efectivo' }))).toBe('facturaX')
    expect(tipoComprobanteInterno(base({ canal: 'promo', formaPago: 'cuenta_corriente' }))).toBe('facturaX')
    expect(tipoComprobanteInterno(base({ canal: 'promo', formaPago: 'contado_efectivo', total: 0, items: [] }))).toBe('remitoPromo')
  })
})

describe('armarRemito', () => {
  const conCambios = () => base({
    comprobanteInterno: { tipo: 'remito', puntoVenta: 2, numero: 15 },
    firmaCliente: 'data:image/png;base64,AAAA',
    firmanteNombre: 'Juan Pérez',
    cambios: [{ productoId: 'cambio_bolsa_3kg', nombre: 'Cambio Hielo bolsa 3kg', cantidad: 2, precioUnitario: 0 }],
  })

  it('se niega para una venta que factura (ARCA o X)', () => {
    expect(armarRemito(base({ formaPago: 'contado_efectivo' })).ok).toBe(false)
    expect(armarRemito(base({ canal: 'promo', formaPago: 'contado_efectivo' })).ok).toBe(false)
  })

  it('Redonhielo con CAI vigente: letra R, CAI en el control, sin precios, bultos y firma', () => {
    const r = armarRemito(conCambios(), undefined, { cai: '12345678901234', vencimiento: new Date('2026-12-31') })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.datos.empresa).toBe('redonhielo')
    expect(r.datos.letra).toBe('R')
    expect(r.datos.control).toEqual({ tipo: 'cai', cai: '12345678901234', vencimiento: new Date('2026-12-31') })
    expect(r.datos.numero).toBe('00002-00000015')
    expect(r.datos.renglones).toEqual([
      { descripcion: 'Hielo bolsa 3kg', cantidad: 10, esCambio: false },
      { descripcion: 'Cambio Hielo bolsa 3kg', cantidad: 2, esCambio: true },
    ])
    expect(r.datos.bultos).toEqual({ entregados: 10, cambios: 2 })
    expect(r.datos.firma?.aclaracion).toBe('Juan Pérez')
    expect(r.datos.leyenda).not.toMatch(/NO VÁLIDO/)
    expect(r.datos.archivo).toBe('remito-00002-00000015.pdf')
  })

  it('Redonhielo sin CAI, o con CAI vencido: letra X y número de control interno', () => {
    const sin = armarRemito(conCambios())
    expect(sin.ok && sin.datos.letra).toBe('X')
    expect(sin.ok && sin.datos.control).toEqual({ tipo: 'interno', codigo: '00002-00000015' })
    expect(sin.ok && sin.datos.leyenda).toMatch(/NO VÁLIDO COMO FACTURA/)

    const vencido = armarRemito(conCambios(), undefined, { cai: '1', vencimiento: new Date('2026-08-31') })
    expect(vencido.ok && vencido.datos.letra).toBe('X')
  })

  it('Rolito (solo cambios, $0): mismo papel, letra X y control interno aunque haya CAI cargado', () => {
    const r = armarRemito(
      base({ canal: 'promo', total: 0, items: [], cambios: [{ productoId: 'cambio_bolsa_3kg', nombre: 'Hielo bolsa 3kg', cantidad: 2, precioUnitario: 0 }], comprobanteInterno: { tipo: 'remitoPromo', puntoVenta: 3, numero: 4 } }),
      undefined,
      { cai: '12345678901234', vencimiento: new Date('2026-12-31') },
    )
    expect(r.ok && r.datos.empresa).toBe('rolito')
    expect(r.ok && r.datos.letra).toBe('X')
    expect(r.ok && r.datos.control).toEqual({ tipo: 'interno', codigo: '00003-00000004' })
    expect(r.ok && r.datos.leyenda).toMatch(/Rolito/)
  })

  it('sin numeración sale igual, con número null y control por id', () => {
    const r = armarRemito(base())
    expect(r.ok && r.datos.numero).toBeNull()
    expect(r.ok && r.datos.control).toEqual({ tipo: 'interno', codigo: 'VENTA123' })
    expect(r.ok && r.datos.archivo).toBe('remito-venta123.pdf')
  })
})

describe('armarFacturaX', () => {
  it('solo para promo cobrada', () => {
    expect(armarFacturaX(base()).ok).toBe(false)
    expect(armarFacturaX(base({ formaPago: 'contado_efectivo' })).ok).toBe(false)
  })

  it('Rolito, letra X, con precios y cambios en $0', () => {
    const r = armarFacturaX(base({
      canal: 'promo', formaPago: 'contado_efectivo',
      comprobanteInterno: { tipo: 'facturaX', puntoVenta: 2, numero: 7 },
      cambios: [{ productoId: 'cambio_bolsa_3kg', nombre: 'Cambio Hielo bolsa 3kg', cantidad: 1, precioUnitario: 0 }],
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.datos.empresa).toBe('rolito')
    expect(r.datos.numero).toBe('00002-00000007')
    expect(r.datos.renglones).toHaveLength(2)
    expect(r.datos.renglones[1].total).toBe(0)
    expect(r.datos.total).toBe(10000)
    expect(r.datos.archivo).toBe('factura-x-00002-00000007.pdf')
  })
})
