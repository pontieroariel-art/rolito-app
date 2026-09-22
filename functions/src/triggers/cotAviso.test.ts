import { describe, expect, it } from 'vitest'
import { avisoCotError, cotPasoAError } from './cotAviso'

describe('aviso de COT en error (2026-09-22)', () => {
  it('avisa cuando el estado pasa a error o cambia el motivo, no en cada reintento igual', () => {
    expect(cotPasoAError({ cot: { estado: 'pendiente' } }, { cot: { estado: 'error', error: '(95) IMPORTE' } })).toBe(true)
    expect(cotPasoAError(undefined, { cot: { estado: 'error', error: 'x' } })).toBe(true)
    expect(cotPasoAError({ cot: { estado: 'error', error: 'x' } }, { cot: { estado: 'error', error: 'x' } })).toBe(false)
    expect(cotPasoAError({ cot: { estado: 'error', error: 'x' } }, { cot: { estado: 'error', error: 'y' } })).toBe(true)
    expect(cotPasoAError({ cot: { estado: 'error', error: 'x' } }, { cot: { estado: 'presentado' } })).toBe(false)
    expect(cotPasoAError({}, { estado: 'entregado' })).toBe(false)
  })
  it('el aviso lleva remito, chofer, camión, kilos y el motivo de ARBA', () => {
    const a = avisoCotError({ codigo: 'RC-DT-000093', choferNombre: 'MORINIGO RAUL', camionLabel: 'AG028YN', kg: 7850, cot: { error: '(106) provincia' } })
    expect(a.titulo).toBe('COT rechazado: RC-DT-000093')
    expect(a.cuerpo).toContain('MORINIGO RAUL · AG028YN · 7.850 kg')
    expect(a.cuerpo).toContain('(106) provincia')
  })
})
