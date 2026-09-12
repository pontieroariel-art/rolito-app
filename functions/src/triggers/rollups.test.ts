import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { cambiaRollup } from './rollups'

const t = (ms: number) => Timestamp.fromMillis(ms)
const base = { status: 'confirmado', clientId: 'c1', clientName: 'Cliente', date: t(1000), products: [{ quantity: 10 }, { quantity: 5 }] }

describe('cambiaRollup (auditoría 2026-09-12)', () => {
  it('alta y baja siempre recalculan', () => {
    expect(cambiaRollup(undefined, base)).toBe(true)
    expect(cambiaRollup(base, undefined)).toBe(true)
  })
  it('cambios que no entran en el rollup (posición del camión, chofer, notas) no recalculan', () => {
    expect(cambiaRollup(base, { ...base, driverLocation: { lat: 1, lng: 2 } } as typeof base)).toBe(false)
    expect(cambiaRollup(base, { ...base, products: [{ quantity: 10 }, { quantity: 5 }] })).toBe(false)
  })
  it('estado, fecha, cliente o cantidades sí', () => {
    expect(cambiaRollup(base, { ...base, status: 'entregado' })).toBe(true)
    expect(cambiaRollup(base, { ...base, date: t(2000) })).toBe(true)
    expect(cambiaRollup(base, { ...base, clientId: 'c2' })).toBe(true)
    expect(cambiaRollup(base, { ...base, products: [{ quantity: 12 }, { quantity: 5 }] })).toBe(true)
  })
})
