import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { armarComprobanteInterno, tipoComprobanteInterno } from './comprobanteInterno'
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

  it('contado en cuenta corriente sale por remito', () => {
    expect(tipoComprobanteInterno(base())).toBe('remito')
  })

  it('promo cobrada sale por factura X; promo en cuenta corriente o en $0, por remito', () => {
    expect(tipoComprobanteInterno(base({ canal: 'promo', formaPago: 'contado_efectivo' }))).toBe('facturaX')
    expect(tipoComprobanteInterno(base({ canal: 'promo', formaPago: 'cuenta_corriente' }))).toBe('remito')
    expect(tipoComprobanteInterno(base({ canal: 'promo', formaPago: 'contado_efectivo', total: 0, items: [] }))).toBe('remito')
  })

  it('una operación de solo cambios en contado también es remito', () => {
    expect(tipoComprobanteInterno(base({ formaPago: 'contado_efectivo', total: 0, items: [] }))).toBe('remito')
  })
})

describe('armarComprobanteInterno', () => {
  it('se niega para una venta que factura ARCA', () => {
    const r = armarComprobanteInterno(base({ formaPago: 'contado_efectivo' }))
    expect(r.ok).toBe(false)
  })

  it('remito de cuenta corriente: Redonhielo, letra X, número con punto de venta propio, firma', () => {
    const r = armarComprobanteInterno(base({
      comprobanteInterno: { tipo: 'remito', puntoVenta: 2, numero: 15 },
      firmaCliente: 'data:image/png;base64,AAAA',
      firmanteNombre: 'Juan Pérez',
      cambios: [{ productoId: 'cambio_bolsa_3kg', nombre: 'Cambio Hielo bolsa 3kg', cantidad: 2, precioUnitario: 0 }],
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.datos.titulo).toBe('REMITO')
    expect(r.datos.letra).toBe('X')
    expect(r.datos.empresa).toBe('redonhielo')
    expect(r.datos.numero).toBe('00002-00000015')
    expect(r.datos.renglones).toHaveLength(2)
    expect(r.datos.renglones[1].total).toBe(0)
    expect(r.datos.total).toBe(10000)
    expect(r.datos.firma?.aclaracion).toBe('Juan Pérez')
    expect(r.datos.leyenda).toMatch(/NO VÁLIDO COMO FACTURA/)
    expect(r.datos.archivo).toBe('remito-00002-00000015.pdf')
  })

  it('factura X de promo: Rolito y leyenda de promo', () => {
    const r = armarComprobanteInterno(base({
      canal: 'promo', formaPago: 'contado_efectivo',
      comprobanteInterno: { tipo: 'facturaX', puntoVenta: 2, numero: 7 },
    }))
    expect(r.ok && r.datos.titulo).toBe('FACTURA')
    expect(r.ok && r.datos.empresa).toBe('rolito')
    expect(r.ok && r.datos.leyenda).toMatch(/Rolito/)
    expect(r.ok && r.datos.archivo).toBe('factura-x-00002-00000007.pdf')
  })

  it('sin numeración sale igual, con número null y archivo por id', () => {
    const r = armarComprobanteInterno(base())
    expect(r.ok && r.datos.numero).toBeNull()
    expect(r.ok && r.datos.archivo).toBe('remito-venta123.pdf')
  })
})
