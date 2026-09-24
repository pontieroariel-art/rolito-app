import { describe, expect, it } from 'vitest'
import { darsenaLibrePara, darsenasParaCamion, darsenasParaVentanilla, ocupacionDarsenas } from './darsenas'

describe('darsenas', () => {
  it('la 1 es solo de camiones; ventanilla se llama de la 2 a la 5; los camiones van a cualquiera', () => {
    expect(darsenasParaCamion('torcuato')).toEqual([1, 2, 3, 4, 5])
    expect(darsenasParaVentanilla('torcuato')).toEqual([2, 3, 4, 5])
    expect(darsenasParaVentanilla('merlo')).not.toContain(1)
  })

  it('cuenta la ocupación por boca: el camión que volvió manda, después la carga, después el turno llamado', () => {
    const o = ocupacionDarsenas({
      cargas:      [{ id: 'b1', darsena: 2 }, { id: 'b2' }, { id: 'b3', darsena: 3 }],
      regresos:    [{ id: 'r1', regreso: { darsena: 3 } }, { id: 'r2', regreso: {} }],
      ventanillas: [
        { id: 'v1', estado: 'pendiente_entrega', turnoEstado: 'llamado', darsena: 4 },
        { id: 'v2', estado: 'pendiente_entrega', turnoEstado: 'en_espera', darsena: 5 },
        { id: 'v3', estado: 'entregada', turnoEstado: 'llamado', darsena: 5 },
        { id: 'v4', estado: 'pendiente_entrega', turnoEstado: 'llamado', darsena: 2 },
      ],
    })
    expect(o.get(2)).toEqual({ tipo: 'carga', id: 'b1' })
    expect(o.get(3)).toEqual({ tipo: 'regreso', id: 'r1' })
    expect(o.get(4)).toEqual({ tipo: 'ventanilla', id: 'v1' })
    expect(o.has(5)).toBe(false)
    expect(o.has(1)).toBe(false)
  })

  it('una boca ocupada queda libre solo para el mismo documento (reasignar la propia)', () => {
    const o = ocupacionDarsenas({ cargas: [{ id: 'b1', darsena: 2 }], regresos: [], ventanillas: [] })
    expect(darsenaLibrePara(o, 2)).toBe(false)
    expect(darsenaLibrePara(o, 2, 'b1')).toBe(true)
    expect(darsenaLibrePara(o, 2, 'b9')).toBe(false)
    expect(darsenaLibrePara(o, 1)).toBe(true)
  })
})
