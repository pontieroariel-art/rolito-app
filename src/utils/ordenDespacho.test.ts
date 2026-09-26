import { describe, expect, it } from 'vitest'
import { moverAPosicion, ordenCompleto } from './ordenDespacho'

describe('ordenCompleto', () => {
  it('respeta el orden guardado y suma al final las paradas nuevas', () => {
    expect(ordenCompleto(['c', 'a', 'b'], ['a', 'b', 'c', 'd'])).toEqual(['c', 'a', 'b', 'd'])
  })
  it('saca las paradas que ya no son del camión', () => {
    expect(ordenCompleto(['x', 'b', 'a'], ['a', 'b'])).toEqual(['b', 'a'])
  })
  it('sin orden guardado usa el de las paradas', () => {
    expect(ordenCompleto(undefined, ['a', 'b'])).toEqual(['a', 'b'])
    expect(ordenCompleto([], [])).toEqual([])
  })
  it('no repite una parada duplicada en el orden guardado', () => {
    expect(ordenCompleto(['a', 'a', 'b'], ['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('moverAPosicion', () => {
  const orden = ['a', 'b', 'c', 'd', 'e']
  it('mueve una parada al número escrito', () => {
    expect(moverAPosicion(orden, 'e', 1)).toEqual(['e', 'a', 'b', 'c', 'd'])
    expect(moverAPosicion(orden, 'a', 3)).toEqual(['b', 'c', 'a', 'd', 'e'])
    expect(moverAPosicion(orden, 'b', 5)).toEqual(['a', 'c', 'd', 'e', 'b'])
  })
  it('fuera de rango va al extremo', () => {
    expect(moverAPosicion(orden, 'c', 99)).toEqual(['a', 'b', 'd', 'e', 'c'])
    expect(moverAPosicion(orden, 'c', 0)).toEqual(['c', 'a', 'b', 'd', 'e'])
  })
  it('número inválido, parada que no está o mismo lugar: sin cambios', () => {
    expect(moverAPosicion(orden, 'c', Number.NaN)).toEqual(orden)
    expect(moverAPosicion(orden, 'z', 2)).toEqual(orden)
    expect(moverAPosicion(orden, 'c', 3)).toEqual(orden)
  })
})
