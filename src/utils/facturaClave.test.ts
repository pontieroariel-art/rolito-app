import { describe, expect, it } from 'vitest'
import { claveFactura, formatoFactura, parsearClaveTango } from './facturaClave'

describe('clave de factura (formato Tango)', () => {
  it('arma y parsea ida y vuelta', () => {
    expect(claveFactura('A', 1104, 62)).toBe('A0110400000062')
    expect(parsearClaveTango('A0110400000062')).toEqual({ letra: 'A', puntoVenta: 1104, numero: 62 })
    expect(parsearClaveTango(' b0010100173697 ')).toEqual({ letra: 'B', puntoVenta: 101, numero: 173697 })
    expect(formatoFactura({ letra: 'A', puntoVenta: 1104, numero: 62 })).toBe('A 01104-00000062')
  })

  it('rechaza lo que no es una factura numerada por Tango', () => {
    expect(parsearClaveTango('')).toBeNull()
    expect(parsearClaveTango(null)).toBeNull()
    expect(parsearClaveTango('A0110462')).toBeNull()
    expect(parsearClaveTango('Z0110400000062')).toBeNull()
  })
})
