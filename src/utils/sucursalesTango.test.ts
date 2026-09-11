import { describe, expect, it } from 'vitest'
import { clienteEnSucursal, etiquetaSucursal, necesitaSucursal, nombreSucursalVenta, sucursalesDe } from './sucursalesTango'
import type { UserProfile } from '@/types'

const dir = (id: string, nombre: string, address: string) => ({ id, nombre, address, lat: null, lng: null, horarioApertura: '', horarioCierre: '', contactoNombre: '', contactoTelefono: '', esPrincipal: false })
const rappi = {
  codigoTango: 'MDP203', idGva14Tango: 10,
  tangoIds: { redonhielo: [{ idGva14: 10, codigo: 'MDP203' }, { idGva14: 11, codigo: 'RAP001' }, { idGva14: 12, codigo: 'RAP002' }], rolito: [{ idGva14: 21, codigo: 'RAP001' }] },
  addresses: [dir('MDP203', 'Principal', 'Belgrano 3434, Mar del Plata'), dir('RAP001', 'GASTRONOMIA (MONROE)', 'Monroe 1616'), dir('RAP002', 'GASTRONOMIA (HUMBOLDT)', 'Humboldt 1877')],
} as unknown as UserProfile

describe('sucursales de Tango', () => {
  it('lista los códigos de la empresa con el nombre y la dirección de su sucursal', () => {
    const s = sucursalesDe(rappi, 'redonhielo')
    expect(s.map((x) => x.codigo)).toEqual(['MDP203', 'RAP001', 'RAP002'])
    expect(etiquetaSucursal(s[1])).toBe('RAP001 · GASTRONOMIA (MONROE) · Monroe 1616')
    expect(sucursalesDe(rappi, 'rolito')).toHaveLength(1)
    expect(necesitaSucursal(rappi, 'redonhielo')).toBe(true)
    expect(necesitaSucursal(rappi, 'rolito')).toBe(false)
  })

  it('clienteEnSucursal pone la identidad elegida en los campos legacy; sin elección, la principal', () => {
    expect(clienteEnSucursal(rappi, 'redonhielo', 'RAP002')).toMatchObject({ codigoTango: 'RAP002', idGva14Tango: 12 })
    expect(clienteEnSucursal(rappi, 'redonhielo', null)).toMatchObject({ codigoTango: 'MDP203', idGva14Tango: 10 })
    expect(clienteEnSucursal(rappi, 'rolito', 'RAP002')).toMatchObject({ codigoTango: 'RAP001', idGva14Tango: 21 })
  })
})

describe('nombreSucursalVenta (nombre de la sucursal para los listados, 2026-09-11)', () => {
  it('con varias sucursales devuelve el nombre de Tango del código elegido; la principal sin nombre propio y las cuentas de un solo código no llevan nada', () => {
    const conTango = { ...rappi, razonSocial: 'GASTRONOMIA EMPRENDIMIENTOS S.A.S - (MAR DEL PLATA)', addresses: rappi.addresses.map((a) => a.id === 'RAP002' ? { ...a, razonSocialTango: 'GASTRONOMIA EMPRENDIMIENTOS S.A.S - (HUMBOLDT)' } : a) } as unknown as UserProfile
    expect(nombreSucursalVenta(conTango, 'redonhielo', 'RAP002')).toBe('GASTRONOMIA EMPRENDIMIENTOS S.A.S - (HUMBOLDT)')
    expect(nombreSucursalVenta(conTango, 'redonhielo', 'RAP001')).toBe('GASTRONOMIA (MONROE)')
    expect(nombreSucursalVenta(conTango, 'redonhielo', 'MDP203')).toBeUndefined()
    expect(nombreSucursalVenta(conTango, 'rolito', 'RAP001')).toBeUndefined()
    expect(nombreSucursalVenta(conTango, 'redonhielo', null)).toBeUndefined()
  })
})
