import { describe, it, expect } from 'vitest'
import { usuarioCorto, leyendaQuienVende, nombreDePlanta } from './comun'

describe('usuarioCorto (STA14.USUARIO, 10 chars)', () => {
  it('inicial + apellido, mayúsculas, sin acentos', () => {
    expect(usuarioCorto('Nicolas Diaz')).toBe('NDIAZ')
    expect(usuarioCorto('Juan Cruz Vañek')).toBe('JVANEK')
    expect(usuarioCorto('Cristian Petti')).toBe('CPETTI')
    expect(usuarioCorto('Pedro')).toBe('PEDRO')
    expect(usuarioCorto('Maximiliano Gonzalezzzzz')).toBe('MGONZALEZZ')
  })
  it('sin nombre devuelve el fallback', () => {
    expect(usuarioCorto(undefined)).toBe('ROLITO')
    expect(usuarioCorto('  ', '')).toBe('')
  })
})

describe('leyendaQuienVende / nombreDePlanta', () => {
  it('caja con planta, chofer con depósito', () => {
    expect(leyendaQuienVende({ cajaId: 'c', cajaNombre: 'Ana', plantaId: 'merlo' }, nombreDePlanta('merlo'))).toBe('Caja Ana - Merlo')
    expect(leyendaQuienVende({ choferId: 'x', choferNombre: 'Pedro' }, 'dep 21')).toBe('Chofer Pedro - dep 21')
    expect(leyendaQuienVende({}, 'dep 21')).toBe('Chofer  - dep 21')
    expect(nombreDePlanta('torcuato')).toBe('Torcuato')
    expect(nombreDePlanta('otra')).toBe('otra')
  })
})
