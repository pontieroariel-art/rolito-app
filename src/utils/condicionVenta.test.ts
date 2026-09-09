import { describe, expect, it } from 'vitest'
import { admiteCuentaCorriente, esCondicionContado } from './condicionVenta'

describe('admiteCuentaCorriente (condición de venta de Tango)', () => {
  it('CONTADO en Tango no puede comprar en cuenta corriente', () => {
    expect(admiteCuentaCorriente({ condicionVenta: 'CONTADO' }).ok).toBe(false)
    expect(admiteCuentaCorriente({ condicionVenta: ' contado ' }).ok).toBe(false)
    expect(esCondicionContado('CONTADO')).toBe(true)
  })
  it('cualquier condición de plazo sí', () => {
    expect(admiteCuentaCorriente({ condicionVenta: '7 DIAS F.F.' })).toEqual({ ok: true })
    expect(admiteCuentaCorriente({ condicionVenta: 'VALORES 30-60-90 DIAS F.F.' })).toEqual({ ok: true })
  })
  it('sin condición cargada no bloquea (decide Tango); sin cliente no hay cta. cte.', () => {
    expect(admiteCuentaCorriente({})).toEqual({ ok: true })
    expect(admiteCuentaCorriente(undefined).ok).toBe(false)
  })
})
