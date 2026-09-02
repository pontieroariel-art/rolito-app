import { describe, it, expect } from 'vitest'
import { documentoDeVenta, facturaContraArca } from './circuito'

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
