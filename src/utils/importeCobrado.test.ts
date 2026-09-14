import { describe, expect, it } from 'vitest'
import { importeCobrado, impuestosDe, sumaCobrada } from './importeCobrado'

describe('importeCobrado', () => {
  it('sin factura de ARCA es el total de lista (remito de cta. cte., promo con factura X)', () => {
    expect(importeCobrado({ total: 108600 })).toBe(108600)
    expect(importeCobrado({ total: 108600, factura: null })).toBe(108600)
    expect(importeCobrado({ total: 108600, factura: { importes: null } })).toBe(108600)
  })
  it('con factura de ARCA es el total de la factura: neto + IVA + percepción (Feijoo 14/09)', () => {
    const v = { total: 108600, factura: { importes: { total: 131406 } } }
    expect(importeCobrado(v)).toBe(131406)
    expect(impuestosDe(v)).toBe(22806)
  })
  it('un total inválido en la factura no rompe: cae al de lista', () => {
    expect(importeCobrado({ total: 100, factura: { importes: { total: NaN } } })).toBe(100)
    expect(impuestosDe({ total: 100 })).toBe(0)
  })
  it('sumaCobrada mezcla ventas con y sin factura', () => {
    expect(sumaCobrada([{ total: 100 }, { total: 100, factura: { importes: { total: 121 } } }])).toBe(221)
  })
})
