import { describe, expect, it } from 'vitest'
import { explicarRotas, resumenDescarga } from './rotasCambios'

describe('explicarRotas', () => {
  it('rotas de más: las del camión no son faltante', () => {
    expect(explicarRotas(5, 7)).toBe('7 bolsas rotas: 5 de los cambios + 2 rotas en el camión. Todas a merma, no son faltante.')
    expect(explicarRotas(0, 1)).toBe('1 bolsa rota en el camión. A merma, no es faltante.')
  })
  it('rotas de menos: el cambio sin su rota es faltante', () => {
    expect(explicarRotas(5, 3)).toBe('5 cambios pero volvieron 3 rotas: 2 cambios sin su bolsa rota cuentan como faltante.')
    expect(explicarRotas(1, 0)).toBe('1 cambio pero volvieron 0 rotas: 1 cambio sin su bolsa rota cuenta como faltante.')
  })
  it('iguales, o nada', () => {
    expect(explicarRotas(6, 6)).toBe('6 bolsas rotas: las de los cambios. A merma.')
    expect(explicarRotas(0, 0)).toBeNull()
  })
})

describe('resumenDescarga', () => {
  const it3 = (id: string, n: number) => ({ productoId: id, nombre: id, cantidad: n })
  it('separa planta y merma y marca las rotas sin ninguna sana', () => {
    const r = resumenDescarga([it3('agua', 0), it3('b3', 2)], [it3('agua', 131), it3('b3', 7), it3('bidon', 3)])
    expect(r.aPlanta.map((i) => i.productoId)).toEqual(['b3'])
    expect(r.aMerma.map((i) => i.productoId)).toEqual(['agua', 'b3', 'bidon'])
    expect(r.dudosos.map((i) => i.productoId)).toEqual(['agua'])   // bidón: 3 rotas, por debajo del mínimo
  })
})
