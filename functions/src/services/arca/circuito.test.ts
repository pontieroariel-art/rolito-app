import { describe, it, expect } from 'vitest'
import { documentoDeVenta, facturaContraArca } from './circuito'

describe('documentoDeVenta', () => {
  it('contado en efectivo o transferencia lo factura la app', () => {
    expect(documentoDeVenta('contado', 'contado_efectivo')).toBe('factura_arca')
    expect(documentoDeVenta('contado', 'contado_transferencia')).toBe('factura_arca')
  })

  it('contado en cuenta corriente va por remito, NO por factura', () => {
    // Este es el caso que motivó el módulo: la oficina factura ese remito desde
    // Tango, así que si la app además facturara, la venta saldría dos veces.
    expect(documentoDeVenta('contado', 'cuenta_corriente')).toBe('remito_a_facturar')
    expect(facturaContraArca('contado', 'cuenta_corriente')).toBe(false)
  })

  it('promo nunca toca ARCA, pague como pague', () => {
    for (const fp of ['contado_efectivo', 'contado_transferencia', 'cuenta_corriente']) {
      expect(documentoDeVenta('promo', fp)).toBe('no_oficial')
      expect(facturaContraArca('promo', fp)).toBe(false)
    }
  })

  it('no decide con datos que no reconoce', () => {
    expect(documentoDeVenta('contado', undefined)).toBeNull()
    expect(documentoDeVenta('contado', '')).toBeNull()
    expect(documentoDeVenta('contado', 'cheque')).toBeNull()
    expect(documentoDeVenta(undefined, 'contado_efectivo')).toBeNull()
    expect(documentoDeVenta('mayorista', 'contado_efectivo')).toBeNull()
    expect(facturaContraArca('contado', undefined)).toBe(false)
  })
})
