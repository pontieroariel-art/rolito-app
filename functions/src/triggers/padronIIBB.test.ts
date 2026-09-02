import { describe, expect, it } from 'vitest'
import { decidirAviso, diasHasta, hoyEnAr } from './padronIIBB'

describe('diasHasta', () => {
  it('cuenta días calendario, no milisegundos', () => {
    expect(diasHasta('2026-09-02', '2026-09-30')).toBe(28)
    expect(diasHasta('2026-09-30', '2026-09-30')).toBe(0)
    expect(diasHasta('2026-10-01', '2026-09-30')).toBe(-1)
  })

  it('atraviesa fin de mes y fin de año', () => {
    expect(diasHasta('2026-12-28', '2027-01-04')).toBe(7)
  })
})

describe('hoyEnAr', () => {
  it('usa el día calendario argentino, no el de la máquina', () => {
    // En Cloud Functions el reloj es UTC: a las 23:30 del 30/9 en Argentina ya
    // es 1/10 en UTC. Si se tomara el día UTC, el aviso se correría un día.
    expect(hoyEnAr(new Date('2026-10-01T02:30:00Z'))).toBe('2026-09-30')
  })
})

describe('decidirAviso', () => {
  const padron = {
    vigenciaDesde: '2026-09-01',
    vigenciaHasta: '2026-09-30',
    clientesConPercepcion: 347,
  }

  it('no avisa cuando falta más de una semana', () => {
    expect(decidirAviso(padron, '2026-09-02')).toBeNull()
    expect(decidirAviso(padron, '2026-09-22')).toBeNull()
  })

  it('avisa desde 7 días antes del vencimiento', () => {
    expect(decidirAviso(padron, '2026-09-23')).toEqual({ tipo: 'por-vencer', dias: 7 })
    expect(decidirAviso(padron, '2026-09-30')).toEqual({ tipo: 'por-vencer', dias: 0 })
  })

  it('avisa todos los días mientras esté vencido', () => {
    // No se silencia como el de "por vencer": mientras siga así no se le puede
    // facturar a ningún cliente con percepción.
    const yaAvisado = { ...padron, ultimoAviso: { tipo: 'vencido', fecha: '2026-10-01' } }
    expect(decidirAviso(yaAvisado, '2026-10-02')).toEqual({ tipo: 'vencido', dias: -2 })
  })

  it('el aviso de "por vencer" no se repite para el mismo padrón', () => {
    const yaAvisado = { ...padron, ultimoAviso: { tipo: 'por-vencer', fecha: '2026-09-24' } }
    expect(decidirAviso(yaAvisado, '2026-09-25')).toBeNull()
  })

  it('vuelve a avisar cuando el padrón es otro', () => {
    // Aviso viejo (de septiembre) contra un padrón de octubre: es otro mes, hay
    // que volver a avisar.
    const octubre = {
      vigenciaDesde: '2026-10-01',
      vigenciaHasta: '2026-10-31',
      ultimoAviso: { tipo: 'por-vencer', fecha: '2026-09-24' },
    }
    expect(decidirAviso(octubre, '2026-10-25')).toEqual({ tipo: 'por-vencer', dias: 6 })
  })

  it('avisa si nunca se importó un padrón', () => {
    expect(decidirAviso(undefined, '2026-09-02')).toEqual({ tipo: 'sin-padron', dias: 0 })
    expect(decidirAviso({}, '2026-09-02')).toEqual({ tipo: 'sin-padron', dias: 0 })
  })
})
