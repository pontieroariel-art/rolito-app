import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { valeLaPenaEspejar } from './location'

const t = (ms: number) => Timestamp.fromMillis(ms)

describe('valeLaPenaEspejar (auditoría 2026-09-12)', () => {
  it('sin posición previa, siempre', () => {
    expect(valeLaPenaEspejar(undefined, { lat: -34.5, lng: -58.6, timestamp: t(60_000) })).toBe(true)
  })
  it('a 20 m y 10 s del anterior, no', () => {
    expect(valeLaPenaEspejar({ lat: -34.5, lng: -58.6, updatedAt: t(50_000) }, { lat: -34.50018, lng: -58.6, timestamp: t(60_000) })).toBe(false)
  })
  it('a más de 40 m sí, y también si pasó más de un minuto sin moverse', () => {
    expect(valeLaPenaEspejar({ lat: -34.5, lng: -58.6, updatedAt: t(50_000) }, { lat: -34.5005, lng: -58.6, timestamp: t(60_000) })).toBe(true)
    expect(valeLaPenaEspejar({ lat: -34.5, lng: -58.6, updatedAt: t(0) }, { lat: -34.5, lng: -58.6, timestamp: t(61_000) })).toBe(true)
  })
})
