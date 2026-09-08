import { describe, expect, it } from 'vitest'
import { ALERTAS_MORA_DEFAULT, nivelMora, normalizarAlertasMora } from './mora'

describe('nivelMora', () => {
  it('verde sin deuda o sin atraso; amarillo y rojo por días; rojo por importe', () => {
    expect(nivelMora(0, 90)).toBe('ok')
    expect(nivelMora(1000, 0)).toBe('ok')
    expect(nivelMora(1000, 29)).toBe('ok')
    expect(nivelMora(1000, 30)).toBe('amarillo')
    expect(nivelMora(1000, 60)).toBe('rojo')
    expect(nivelMora(500_000, 30)).toBe('rojo')
    expect(nivelMora(499_999, 59)).toBe('amarillo')
  })

  it('respeta umbrales propios', () => {
    expect(nivelMora(1000, 10, { diasAmarillo: 7, diasRojo: 15, importeRojo: 1 })).toBe('rojo')
    expect(nivelMora(1000, 10, { diasAmarillo: 7, diasRojo: 15, importeRojo: 1_000_000 })).toBe('amarillo')
  })
})

describe('normalizarAlertasMora', () => {
  it('defaults y saneo', () => {
    expect(normalizarAlertasMora(null)).toEqual(ALERTAS_MORA_DEFAULT)
    expect(normalizarAlertasMora({ diasAmarillo: -5, diasRojo: 'x' as unknown as number })).toEqual(ALERTAS_MORA_DEFAULT)
    // rojo nunca por debajo de amarillo
    expect(normalizarAlertasMora({ diasAmarillo: 45, diasRojo: 20 })).toEqual({ diasAmarillo: 45, diasRojo: 45, importeRojo: 500_000 })
  })
})
