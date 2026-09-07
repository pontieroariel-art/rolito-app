import { describe, expect, it } from 'vitest'
import { direccionPrincipal, normalizarTelefonoAR, urlLlamar, urlMapa, urlWhatsApp } from './contacto'

describe('normalizarTelefonoAR', () => {
  it('convierte formatos locales al internacional 549', () => {
    expect(normalizarTelefonoAR('011 4741-8000')).toBe('5491147418000')
    expect(normalizarTelefonoAR('011 15 4431 1398')).toBe('5491144311398')
    expect(normalizarTelefonoAR('+54 9 11 4431-1398')).toBe('5491144311398')
    expect(normalizarTelefonoAR('0348-15-4431398')).toBe('5493484431398')
    expect(normalizarTelefonoAR('4741-8000')).toBe('')
    expect(normalizarTelefonoAR('')).toBe('')
  })
})

describe('urls', () => {
  it('llamar y WhatsApp', () => {
    expect(urlLlamar('011 4741-8000')).toBe('tel:01147418000')
    expect(urlLlamar('12')).toBeNull()
    expect(urlWhatsApp('011 4741-8000', 'Hola')).toBe('https://wa.me/5491147418000?text=Hola')
    expect(urlWhatsApp('abc')).toBeNull()
  })

  it('mapa: coordenadas si hay, si no la dirección', () => {
    expect(urlMapa({ lat: -34.48, lng: -58.6, address: 'x' })).toBe('https://www.google.com/maps/search/?api=1&query=-34.48,-58.6')
    expect(urlMapa({ lat: null, lng: null, address: 'Av. Perón 800, Pilar' })).toBe('https://www.google.com/maps/search/?api=1&query=Av.%20Per%C3%B3n%20800%2C%20Pilar')
    expect(urlMapa({ address: '  ' })).toBeNull()
  })

  it('direccionPrincipal prioriza la marcada, después la primera, después la legacy', () => {
    const a = { id: '1', nombre: 'A', address: 'Calle 1', lat: null, lng: null, horarioApertura: '', horarioCierre: '', contactoNombre: '', contactoTelefono: '', esPrincipal: false }
    const b = { ...a, id: '2', address: 'Calle 2', esPrincipal: true }
    expect(direccionPrincipal({ addresses: [a, b], address: 'legacy' })?.address).toBe('Calle 2')
    expect(direccionPrincipal({ addresses: [a], address: 'legacy' })?.address).toBe('Calle 1')
    expect(direccionPrincipal({ addresses: [], address: 'legacy', lat: 1, lng: 2 })).toEqual({ address: 'legacy', lat: 1, lng: 2 })
    expect(direccionPrincipal({ addresses: [], address: '' })).toBeNull()
  })
})
