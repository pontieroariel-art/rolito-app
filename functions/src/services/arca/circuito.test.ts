import { describe, it, expect } from 'vitest'
import { destinoTango, documentoDeVenta, facturaContraArca } from './circuito'

describe('documentoDeVenta', () => {
  it('contado en efectivo o transferencia lo factura la app', () => {
    expect(documentoDeVenta('contado', 'contado_efectivo', 20000)).toBe('factura_arca')
    expect(documentoDeVenta('contado', 'contado_transferencia', 20000)).toBe('factura_arca')
  })

  it('contado en cuenta corriente va por remito, NO por factura', () => {
    // Este es el caso que motivó el módulo: la oficina factura ese remito desde
    // Tango, así que si la app además facturara, la venta saldría dos veces.
    expect(documentoDeVenta('contado', 'cuenta_corriente', 20000)).toBe('remito')
    expect(facturaContraArca('contado', 'cuenta_corriente', 20000)).toBe(false)
  })

  it('promo nunca toca ARCA, pague como pague', () => {
    for (const fp of ['contado_efectivo', 'contado_transferencia', 'cuenta_corriente']) {
      expect(documentoDeVenta('promo', fp, 20000)).toBe('no_oficial')
      expect(facturaContraArca('promo', fp, 20000)).toBe(false)
    }
  })

  it('una operación sin importe sale por remito: no hay nada que facturar', () => {
    // Solo cambios (la bolsa rota por una nueva): mercadería que se mueve sin
    // plata. ARCA además rechaza un comprobante en cero.
    expect(documentoDeVenta('contado', 'contado_efectivo', 0)).toBe('remito')
    expect(documentoDeVenta('contado', 'contado_transferencia', 0)).toBe('remito')
    expect(facturaContraArca('contado', 'contado_efectivo', 0)).toBe(false)
  })

  it('no decide con datos que no reconoce', () => {
    expect(documentoDeVenta('contado', undefined, 20000)).toBeNull()
    expect(documentoDeVenta('contado', '', 20000)).toBeNull()
    expect(documentoDeVenta('contado', 'cheque', 20000)).toBeNull()
    expect(documentoDeVenta(undefined, 'contado_efectivo', 20000)).toBeNull()
    expect(documentoDeVenta('mayorista', 'contado_efectivo', 20000)).toBeNull()
    expect(documentoDeVenta('contado', 'contado_efectivo', undefined)).toBeNull()
    expect(documentoDeVenta('contado', 'contado_efectivo', 'mucho')).toBeNull()
    expect(facturaContraArca('contado', undefined, 20000)).toBe(false)
  })
})

describe('destinoTango', () => {
  it('contado cobrado va como FACTURA a Redonhielo, con el CAE que ya pidió la app', () => {
    // Es el punto delicado de toda la integración: si Tango le pidiera a ARCA
    // un CAE propio, la misma operación quedaría autorizada dos veces.
    expect(destinoTango('contado', 'contado_efectivo', 20000)).toEqual({
      entidad: 'factura', empresa: 'redonhielo', conCaePropio: true,
    })
    expect(destinoTango('contado', 'contado_transferencia', 20000)?.conCaePropio).toBe(true)
  })

  it('contado en cuenta corriente va como REMITO a Redonhielo, sin CAE', () => {
    expect(destinoTango('contado', 'cuenta_corriente', 20000)).toEqual({
      entidad: 'remito', empresa: 'redonhielo', conCaePropio: false,
    })
  })

  it('promo va a Rolito siempre como factura X, cobrada o en cuenta corriente', () => {
    expect(destinoTango('promo', 'contado_efectivo', 20000)).toEqual({
      entidad: 'factura', empresa: 'rolito', conCaePropio: false,
    })
    expect(destinoTango('promo', 'cuenta_corriente', 20000)).toEqual({
      entidad: 'factura', empresa: 'rolito', conCaePropio: false,
    })
  })

  it('una operación de solo cambios va como remito, en las dos empresas', () => {
    expect(destinoTango('contado', 'contado_efectivo', 0)?.entidad).toBe('remito')
    expect(destinoTango('promo', 'contado_efectivo', 0)?.entidad).toBe('remito')
  })

  it('nunca manda un comprobante de Rolito con CAE de ARCA', () => {
    for (const fp of ['contado_efectivo', 'contado_transferencia', 'cuenta_corriente']) {
      expect(destinoTango('promo', fp, 20000)?.conCaePropio).toBe(false)
    }
  })

  it('no decide con datos que no reconoce', () => {
    expect(destinoTango('contado', 'cheque', 20000)).toBeNull()
    expect(destinoTango('mayorista', 'contado_efectivo', 20000)).toBeNull()
  })
})
