import { describe, expect, it } from 'vitest'
import { hayQueEnviarGps } from './envioGps'

const t0 = 1_790_000_000_000
const ultimo = { lat: -34.5, lng: -58.6, en: t0 }

describe('hayQueEnviarGps (auditoría chofer R5)', () => {
  it('el primer envío siempre sale', () => {
    expect(hayQueEnviarGps(null, -34.5, -58.6, t0)).toBe(true)
  })
  it('parado en el cliente (20 m, 10 s) no escribe', () => {
    expect(hayQueEnviarGps(ultimo, -34.50018, -58.6, t0 + 10_000)).toBe(false)
  })
  it('en marcha (55 m en 10 s) escribe como antes', () => {
    expect(hayQueEnviarGps(ultimo, -34.5005, -58.6, t0 + 10_000)).toBe(true)
  })
  it('parado pero pasó un minuto: escribe para que el mapa lo vea al día', () => {
    expect(hayQueEnviarGps(ultimo, -34.5, -58.6, t0 + 60_000)).toBe(true)
    expect(hayQueEnviarGps(ultimo, -34.5, -58.6, t0 + 59_999)).toBe(false)
  })
})
