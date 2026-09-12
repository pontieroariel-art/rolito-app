import { describe, expect, it } from 'vitest'
import {
  cuadrarEnvases, describirEnvases, describirRacks, envasesDeDescarga, envasesDeRemito, filasDeEnvases, parseRacks,
} from './envases'

describe('envasesDeRemito / envasesDeDescarga', () => {
  it('con envases: 4 puntales por pallet de cualquier tipo y 1 aro solo por tarima de madera', () => {
    const e = envasesDeRemito({ palletsCarga: 5, envases: { tarimasMadera: 3, palletsMetal: 2, racks: [12, 15] } })
    expect(e).toEqual({ tarimasMadera: 3, palletsMetal: 2, puntales: 20, aros: 3, racks: [12, 15], origen: 'envases' })
  })

  it('remito viejo (sin envases): palletsCarga se lee como pallets de metal', () => {
    expect(envasesDeRemito({ palletsCarga: 4 })).toEqual({ tarimasMadera: 0, palletsMetal: 4, puntales: 16, aros: 0, racks: [], origen: 'legacy' })
  })

  it('descarga vieja: completos + parciales + vacíos como pallets de metal con sus implícitos', () => {
    expect(envasesDeDescarga({ palletsCompletos: 3, palletsParciales: 2, palletsVacios: 4 }))
      .toEqual({ tarimasMadera: 0, palletsMetal: 9, puntales: 36, aros: 0, racks: [], origen: 'legacy' })
  })

  it('descarga nueva se toma tal cual (puntales y aros contados sueltos)', () => {
    const e = envasesDeDescarga({ envases: { tarimasMadera: 3, palletsMetal: 2, puntales: 19, aros: 5, racks: [12, 18] } })
    expect(e).toMatchObject({ tarimasMadera: 3, palletsMetal: 2, puntales: 19, aros: 5, racks: [12, 18], origen: 'envases' })
  })
})

describe('cuadrarEnvases', () => {
  it('diferencia por tipo y racks faltantes por número', () => {
    const c = cuadrarEnvases(
      [{ palletsCarga: 5, envases: { tarimasMadera: 3, palletsMetal: 2, racks: [12, 15, 18] } }],
      [{ envases: { tarimasMadera: 3, palletsMetal: 2, puntales: 19, aros: 5, racks: [18, 12] } }],
    )
    expect(c.salieron).toEqual({ tarimasMadera: 3, palletsMetal: 2, puntales: 20, aros: 3, racks: [12, 15, 18] })
    expect(c.volvieron).toEqual({ tarimasMadera: 3, palletsMetal: 2, puntales: 19, aros: 5, racks: [12, 18] })
    expect(c.diferencia).toEqual({ tarimasMadera: 0, palletsMetal: 0, puntales: -1, aros: 2 })
    expect(c.racksFaltantes).toEqual([15])
    expect(c.racksSobrantes).toEqual([])
  })

  it('un día viejo (remito y descarga sin envases) cuadra sin fantasmas', () => {
    const c = cuadrarEnvases([{ palletsCarga: 10 }], [{ palletsCompletos: 3, palletsParciales: 2, palletsVacios: 4 }])
    expect(c.diferencia).toEqual({ tarimasMadera: 0, palletsMetal: -1, puntales: -4, aros: 0 })
    expect(c.racksFaltantes).toEqual([])
  })

  it('suma varios remitos y descargas, y detecta racks sobrantes', () => {
    const c = cuadrarEnvases(
      [{ palletsCarga: 1, envases: { tarimasMadera: 1, palletsMetal: 0, racks: [1] } }, { palletsCarga: 1, envases: { tarimasMadera: 0, palletsMetal: 1, racks: [2] } }],
      [{ envases: { tarimasMadera: 1, palletsMetal: 0, puntales: 4, aros: 1, racks: [1] } }, { envases: { tarimasMadera: 0, palletsMetal: 1, puntales: 4, aros: 0, racks: [2, 9] } }],
    )
    expect(c.salieron).toMatchObject({ tarimasMadera: 1, palletsMetal: 1, puntales: 8, aros: 1, racks: [1, 2] })
    expect(c.diferencia).toEqual({ tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0 })
    expect(c.racksSobrantes).toEqual([9])
  })

  it('sin movimientos, todo en cero', () => {
    const c = cuadrarEnvases([], [])
    expect(c.salieron.racks).toEqual([])
    expect(c.diferencia).toEqual({ tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0 })
  })
})

describe('parseRacks / describir', () => {
  it('acepta separadores variados, descarta basura y repetidos, conserva el orden', () => {
    expect(parseRacks('12, 15 18;20')).toEqual([12, 15, 18, 20])
    expect(parseRacks('12 12 0 abc 7')).toEqual([12, 7])
    expect(parseRacks('')).toEqual([])
  })

  it('describe lo que hay y omite los ceros', () => {
    expect(describirEnvases({ tarimasMadera: 3, palletsMetal: 0, puntales: 12, aros: 1, racks: [15, 12] })).toBe('3 madera · 12 puntales · 1 aro · racks Nº 12, 15')
    expect(describirEnvases({ tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, racks: [] })).toBe('')
    expect(describirRacks([])).toBe('sin racks')
  })

  it('filasDeEnvases: un remito viejo es una sola fila de pallets sin composición', () => {
    expect(filasDeEnvases(envasesDeRemito({ palletsCarga: 2 }))).toEqual([{ nombre: 'Pallets (sin composición)', q: 2 }])
    expect(filasDeEnvases(envasesDeRemito({ palletsCarga: 1, envases: { tarimasMadera: 1, palletsMetal: 0, racks: [3] } })).map((f) => f.nombre))
      .toEqual(['Pallets de madera', 'Puntales', 'Aros', 'Racks de agua Nº 3'])
  })
})
