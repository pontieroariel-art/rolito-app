import { describe, it, expect } from 'vitest'
import { avisoDocumento, documentoDeVenta } from './circuitoDocumento'

describe('documentoDeVenta: la regla que antes vivía en la cabeza del chofer', () => {
  it('Redonhielo (contado): cuenta corriente es remito, contado es factura', () => {
    expect(documentoDeVenta('contado', 'cuenta_corriente', 1000)).toBe('remito')
    expect(documentoDeVenta('contado', 'contado_efectivo', 1000)).toBe('factura_arca')
    expect(documentoDeVenta('contado', 'contado_transferencia', 1000)).toBe('factura_arca')
  })

  it('Rolito (promo): siempre factura X, pague como pague', () => {
    expect(documentoDeVenta('promo', 'cuenta_corriente', 1000)).toBe('no_oficial')
    expect(documentoDeVenta('promo', 'contado_efectivo', 1000)).toBe('no_oficial')
  })

  it('sin forma de pago o sin canal todavía no se puede afirmar nada', () => {
    expect(documentoDeVenta('contado', null, 1000)).toBeNull()
    expect(documentoDeVenta(null, 'contado_efectivo', 1000)).toBeNull()
  })

  it('solo cambios (total cero) mueve mercadería: sale remito', () => {
    expect(documentoDeVenta('contado', 'contado_efectivo', 0)).toBe('remito')
  })
})

describe('avisoDocumento: la consecuencia en palabras del chofer', () => {
  it('pone el papel grande y una explicación corta', () => {
    expect(avisoDocumento('remito')).toEqual({ papel: 'REMITO', detalle: 'la factura la hace la oficina' })
    expect(avisoDocumento('factura_arca').papel).toBe('FACTURA')
    expect(avisoDocumento('no_oficial').papel).toBe('FACTURA X')
  })

  it('sin documento invita a elegir la forma de pago, no deja un hueco', () => {
    const a = avisoDocumento(null)
    expect(a.papel).toBe('')
    expect(a.detalle).toMatch(/Elegí/)
  })
})
