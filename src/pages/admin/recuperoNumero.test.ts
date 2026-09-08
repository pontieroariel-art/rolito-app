import { describe, expect, it } from 'vitest'
import { numero } from './RecuperoFacturasPage'

describe('numero (importes tipeados en Recupero)', () => {
  it('acepta coma decimal, punto decimal y punto de miles', () => {
    expect(numero('14644,04')).toBe(14644.04)
    expect(numero('14.644,04')).toBe(14644.04)
    expect(numero('14644.04')).toBe(14644.04)
    expect(numero('1.464.404')).toBe(1464404)
    expect(numero('3.5')).toBe(3.5)
    expect(numero('3,5')).toBe(3.5)
    expect(numero('')).toBe(0)
  })
})
