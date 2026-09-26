import { describe, it, expect } from 'vitest'
import { erroresTurnos, minutosDe, nombreTurnoDe, turnoEn, TURNOS_POR_DEFECTO } from './turnosProduccion'

const a = (h: number, m = 0, dia = 28) => new Date(2026, 8, dia, h, m)

describe('turnoEn', () => {
  it('mañana y tarde dentro del día', () => {
    const t = turnoEn(a(9, 30), TURNOS_POR_DEFECTO)!
    expect(t.turno.nombre).toBe('Mañana')
    expect(t.inicio).toEqual(a(6))
    expect(t.fin).toEqual(a(14))
    expect(turnoEn(a(14), TURNOS_POR_DEFECTO)!.turno.nombre).toBe('Tarde')
  })
  it('la noche cruza la medianoche en las dos puntas', () => {
    const antes = turnoEn(a(23, 10), TURNOS_POR_DEFECTO)!
    expect(antes.turno.nombre).toBe('Noche')
    expect(antes.inicio).toEqual(a(22))
    expect(antes.fin).toEqual(a(6, 0, 29))
    const despues = turnoEn(a(3, 0, 29), TURNOS_POR_DEFECTO)!
    expect(despues.turno.nombre).toBe('Noche')
    expect(despues.inicio).toEqual(a(22))
    expect(despues.fin).toEqual(a(6, 0, 29))
  })
  it('un hueco sin turno devuelve null', () => {
    expect(turnoEn(a(5), [{ nombre: 'Día', desde: '06:00', hasta: '18:00' }])).toBeNull()
    expect(nombreTurnoDe(a(5), [{ nombre: 'Día', desde: '06:00', hasta: '18:00' }])).toBe('Fuera de turno')
  })
})

describe('validación', () => {
  it('horas y nombres', () => {
    expect(minutosDe('06:30')).toBe(390)
    expect(minutosDe('24:00')).toBeNull()
    expect(erroresTurnos(TURNOS_POR_DEFECTO)).toEqual([])
    expect(erroresTurnos([{ nombre: '', desde: '6', hasta: '14:00' }])).toHaveLength(2)
    expect(erroresTurnos([])).toHaveLength(1)
  })
})
