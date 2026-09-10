import { describe, expect, it } from 'vitest'
import { indiceDeCliente, mismoIndice } from './clientesIndex'

const perfil = {
  rol: 'cliente', estado: 'activo', razonSocial: 'ALGAR S.R.L.', nombreContacto: 'Juan', cuit: '30-66178840-9', codigoCliente: 'C-12',
  codigoTango: 'PA.003', idGva14Tango: 7738,
  tangoIds: { redonhielo: [{ idGva14: 7738, codigo: 'PA.003' }, { idGva14: 7739, codigo: 'PA.004' }], rolito: [{ idGva14: 5, codigo: 'CA.64' }] },
  addresses: [{ id: 'PA.003', nombre: 'Principal', address: 'Mitre 596', esPrincipal: true }, { id: 'PA.004', nombre: 'ALGAR SAN LORENZO', address: 'San Lorenzo 10' }],
  localidadTango: 'SAN MIGUEL', preciosTango: { redonhielo: { a: 1 } },
}

describe('indiceDeCliente', () => {
  it('arma el índice con códigos sin repetir, sucursales y dirección principal', () => {
    const i = indiceDeCliente('u1', perfil)!
    expect(i).toEqual({
      uid: 'u1', razonSocial: 'ALGAR S.R.L.', nombreContacto: 'Juan', cuit: '30-66178840-9', codigoCliente: 'C-12',
      codigos: ['PA.003', 'PA.004', 'CA.64'], sucursales: ['ALGAR SAN LORENZO'], direccion: 'Mitre 596', localidad: 'SAN MIGUEL',
      estado: 'activo', vinculadoTango: true,
    })
  })
  it('no es cliente → null; sin Tango → vinculadoTango false; sin razón social cae al contacto', () => {
    expect(indiceDeCliente('u', { rol: 'chofer' })).toBeNull()
    const i = indiceDeCliente('u', { rol: 'cliente', nombreContacto: 'Pepe', sinCuit: true, address: 'Calle 1' })!
    expect(i).toMatchObject({ razonSocial: 'Pepe', sinCuit: true, codigos: [], vinculadoTango: false, direccion: 'Calle 1', estado: 'pendiente' })
  })
})

describe('mismoIndice', () => {
  it('ignora cambios que no son del índice (precios) y detecta los que sí', () => {
    const a = indiceDeCliente('u1', perfil)
    const b = indiceDeCliente('u1', { ...perfil, preciosTango: { redonhielo: { a: 2 } } })
    expect(mismoIndice(a, b)).toBe(true)
    expect(mismoIndice(a, indiceDeCliente('u1', { ...perfil, estado: 'inactivo' }))).toBe(false)
    expect(mismoIndice(a, indiceDeCliente('u1', { ...perfil, tangoIds: { redonhielo: [{ idGva14: 7738, codigo: 'PA.003' }] } }))).toBe(false)
    expect(mismoIndice(null, null)).toBe(true)
    expect(mismoIndice(a, null)).toBe(false)
  })
})
