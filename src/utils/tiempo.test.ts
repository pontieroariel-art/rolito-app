import { describe, expect, it } from 'vitest'
import { esDatoViejo, haceCuanto } from './tiempo'

const ahora = new Date('2026-09-13T18:00:00')
const hace = (ms: number) => ({ toDate: () => new Date(ahora.getTime() - ms) })
const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA

describe('haceCuanto', () => {
  it('pasa de segundos a minutos, horas y días', () => {
    expect(haceCuanto(hace(30_000), ahora)).toBe('recién')
    expect(haceCuanto(hace(5 * MIN), ahora)).toBe('hace 5 min')
    expect(haceCuanto(hace(59 * MIN), ahora)).toBe('hace 59 min')
    expect(haceCuanto(hace(3 * HORA), ahora)).toBe('hace 3 h')
    expect(haceCuanto(hace(23 * HORA), ahora)).toBe('hace 23 h')
    expect(haceCuanto(hace(DIA), ahora)).toBe('hace 1 día')
    expect(haceCuanto(hace(3 * DIA), ahora)).toBe('hace 3 días')
  })

  it('sin fecha devuelve vacío (la pantalla decide qué poner)', () => {
    expect(haceCuanto(undefined, ahora)).toBe('')
    expect(haceCuanto(null, ahora)).toBe('')
  })
})

describe('esDatoViejo', () => {
  it('es viejo a partir de las 24 h: ahí el saldo deja de ser confiable para cobrar', () => {
    expect(esDatoViejo(hace(23 * HORA), ahora)).toBe(false)
    expect(esDatoViejo(hace(DIA), ahora)).toBe(true)
    expect(esDatoViejo(hace(3 * DIA), ahora)).toBe(true)
    expect(esDatoViejo(undefined, ahora)).toBe(false)
  })
})
