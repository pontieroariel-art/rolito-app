import { describe, expect, it } from 'vitest'
import { domiciliosDelCliente, filtrarDomicilios, telDe, urlComoLlegar, urlMapaEmbebido, urlVender, urlWaze } from './buscarClienteChofer'
import type { DeliveryAddress } from '@/types'

const dir = (p: Partial<DeliveryAddress>): DeliveryAddress => ({
  id: 'X', nombre: '', address: '', lat: null, lng: null, horarioApertura: '', horarioCierre: '',
  contactoNombre: '', contactoTelefono: '', esPrincipal: false, ...p,
})

describe('domiciliosDelCliente', () => {
  it('usa el índice mientras no llega la ficha', () => {
    const r = domiciliosDelCliente({ direccion: 'Av. 1', telefono: '11 5555', domicilios: [
      { id: 'C1', nombre: 'Casa', direccion: 'Av. 1', lat: -34.5, lng: -58.6 },
      { id: 'C2', nombre: 'Monroe', direccion: 'Monroe 100', lat: null, lng: null },
    ] })
    expect(r.map((d) => d.id)).toEqual(['C1', 'C2'])
    expect(r[0]!.principal).toBe(true)
    expect(r[1]!.telefono).toBe('11 5555')
  })

  it('con la ficha suma horario y contacto, y pone el principal primero', () => {
    const r = domiciliosDelCliente(null, { telefono: '11 1', addresses: [
      dir({ id: 'A', nombre: 'Suc A', address: 'Calle A' }),
      dir({ id: 'B', nombre: 'Suc B', address: 'Calle B', esPrincipal: true, horarioApertura: '06:00', horarioCierre: '12:00', contactoNombre: 'Juan', contactoTelefono: '11 2' }),
    ] })
    expect(r[0]!.id).toBe('B')
    expect(r[0]!.horario).toBe('06:00 a 12:00')
    expect(r[0]!.telefono).toBe('11 2')
    expect(r[1]!.telefono).toBe('11 1')
  })

  it('sin domicilios cae en la dirección suelta', () => {
    expect(domiciliosDelCliente({ direccion: 'Solo esta', domicilios: [] })).toHaveLength(1)
    expect(domiciliosDelCliente(null, null)).toEqual([])
  })
})

describe('botones', () => {
  it('por coordenadas si las hay, si no por la dirección', () => {
    expect(urlComoLlegar({ lat: -34.5, lng: -58.6, direccion: 'x' })).toContain('destination=-34.5,-58.6')
    expect(urlComoLlegar({ lat: null, lng: null, direccion: 'Av. San Martín 10' })).toContain('Av.%20San%20Mart')
    expect(urlComoLlegar({ lat: null, lng: null, direccion: ' ' })).toBeNull()
    expect(urlWaze({ lat: -34.5, lng: -58.6, direccion: '' })).toContain('ll=-34.5,-58.6')
  })

  it('el 0,0 de un geocode fallido no es una ubicación', () => {
    expect(urlMapaEmbebido({ lat: 0, lng: 0 })).toBeNull()
    expect(urlMapaEmbebido({ lat: -34.5, lng: -58.6 })).toContain('output=embed')
  })

  it('filtra sucursales por nombre o calle y limpia el teléfono', () => {
    const lista = domiciliosDelCliente({ direccion: '', domicilios: [
      { id: 'C1', nombre: 'Coto Monroe', direccion: 'Monroe 100', lat: null, lng: null },
      { id: 'C2', nombre: 'Coto Pilar', direccion: 'Ruta 8', lat: null, lng: null },
    ] })
    expect(filtrarDomicilios(lista, 'pilar').map((d) => d.id)).toEqual(['C2'])
    expect(filtrarDomicilios(lista, '')).toHaveLength(2)
    expect(telDe('(011) 4555-1234')).toBe('01145551234')
  })
})

describe('urlVender', () => {
  it('manda la sucursal por su código de Tango', () => {
    expect(urlVender('u1', { id: 'FC.101' })).toBe('/chofer/venta?cliente=u1&sucursal=FC.101')
    expect(urlVender('u1', { id: '099001' })).toBe('/chofer/venta?cliente=u1&sucursal=099001')
  })
  it('sin código de Tango no manda sucursal', () => {
    expect(urlVender('u1', { id: 'legacy' })).toBe('/chofer/venta?cliente=u1')
    expect(urlVender('u1', { id: 'sin-codigo-2' })).toBe('/chofer/venta?cliente=u1')
    expect(urlVender('u1')).toBe('/chofer/venta?cliente=u1')
  })
})
