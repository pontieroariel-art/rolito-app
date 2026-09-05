import { describe, it, expect } from 'vitest'
import { normalizarBusqueda, coincideBusqueda } from './busqueda'

describe('normalizarBusqueda', () => {
  it('saca puntos, espacios, guiones y acentos, y pasa a minúsculas', () => {
    expect(normalizarBusqueda('F.C. 280')).toBe('fc280')
    expect(normalizarBusqueda('Peña-Hnos')).toBe('penahnos')
    expect(normalizarBusqueda(null)).toBe('')
    expect(normalizarBusqueda('...')).toBe('')
  })
})

describe('coincideBusqueda', () => {
  const cliente = { codigo: 'FC.280', nombre: 'QUIROGA HUGO' }

  it('el autocorrector del iPad ("F.C.") encuentra igual a FC.280', () => {
    expect(coincideBusqueda('F.C.', cliente.nombre, cliente.codigo)).toBe(true)
    expect(coincideBusqueda('F.C.280', cliente.nombre, cliente.codigo)).toBe(true)
    expect(coincideBusqueda('fc 280', cliente.nombre, cliente.codigo)).toBe(true)
    expect(coincideBusqueda('280', cliente.nombre, cliente.codigo)).toBe(true)
  })

  it('busca por nombre sin importar acentos ni mayúsculas', () => {
    expect(coincideBusqueda('quiróga', cliente.nombre, cliente.codigo)).toBe(true)
    expect(coincideBusqueda('quirogahugo', cliente.nombre, cliente.codigo)).toBe(true)
    expect(coincideBusqueda('perez', cliente.nombre, cliente.codigo)).toBe(false)
  })

  it('una query vacía o de solo puntuación coincide con todo', () => {
    expect(coincideBusqueda('', cliente.nombre)).toBe(true)
    expect(coincideBusqueda(' . ', cliente.nombre)).toBe(true)
  })

  it('ignora campos vacíos o undefined', () => {
    expect(coincideBusqueda('fc', undefined, null, '')).toBe(false)
    expect(coincideBusqueda('fc', undefined, 'FC.1')).toBe(true)
  })
})
