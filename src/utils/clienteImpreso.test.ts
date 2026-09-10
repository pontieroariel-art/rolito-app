import { describe, expect, it } from 'vitest'
import { clienteImpreso, nombreImpresoSucursal } from './clienteImpreso'
import type { DeliveryAddress, UserProfile } from '@/types'

const dir = (id: string, nombre: string, address: string, tango: Partial<DeliveryAddress> = {}): DeliveryAddress => ({
  id, nombre, address, lat: null, lng: null, horarioApertura: '', horarioCierre: '', contactoNombre: '', contactoTelefono: '', esPrincipal: id === 'MDP203', ...tango,
})

// Rappi: 3 códigos en Redonhielo, 1 en Rolito. RAP002 tiene la ficha de Tango
// por sucursal (sync nueva); RAP001 solo la dirección plana (sync vieja).
const rappi = {
  uid: 'u1', razonSocial: 'RAPPI ARG S.A.S.', cuit: '30-71234567-8', categoriaIvaTangoDesc: 'Responsable Inscripto',
  address: 'Belgrano 3434, Mar del Plata, Buenos Aires', codigoCliente: 'C-100',
  codigoTango: 'MDP203', idGva14Tango: 10, localidadTango: 'MAR DEL PLATA', codigoPostalTango: '7600',
  tangoIds: { redonhielo: [{ idGva14: 10, codigo: 'MDP203' }, { idGva14: 11, codigo: 'RAP001' }, { idGva14: 12, codigo: 'RAP002' }], rolito: [{ idGva14: 21, codigo: 'RAP001' }] },
  addresses: [
    dir('MDP203', 'Principal', 'Belgrano 3434, Mar del Plata, Buenos Aires'),
    dir('RAP001', 'GASTRONOMIA (MONROE)', 'Monroe 1616, CABA, Capital Federal'),
    dir('RAP002', 'GASTRONOMIA (HUMBOLDT)', 'Humboldt 1877, CABA, Capital Federal', {
      domicilioTango: 'HUMBOLDT 1877', localidadTango: 'PALERMO', codigoPostalTango: '1414', razonSocialTango: 'RAPPI ARG S.A.S.', nombreComercialTango: 'RAPPI HUMBOLDT',
    }),
  ],
} as unknown as UserProfile

const venta = (over: { canal?: 'contado' | 'promo'; clienteCodigoTango?: string } = {}) =>
  ({ canal: 'contado' as const, clienteNombre: 'RAPPI ARG S.A.S.', ...over })

describe('clienteImpreso', () => {
  it('sin código en la venta imprime la casa central, como siempre', () => {
    expect(clienteImpreso(venta(), rappi)).toEqual({
      razonSocial: 'RAPPI ARG S.A.S.', sucursal: '', domicilio: 'Belgrano 3434, Mar del Plata, Buenos Aires',
      localidadCp: '7600, MAR DEL PLATA', codigoCliente: 'MDP203', cuit: '30-71234567-8', condicionIva: 'Responsable Inscripto',
    })
  })

  it('sin ficha solo puede poner el nombre de la venta y el código', () => {
    expect(clienteImpreso(venta({ clienteCodigoTango: 'RAP002' }), undefined)).toEqual({
      razonSocial: 'RAPPI ARG S.A.S.', sucursal: '', domicilio: '', localidadCp: '', codigoCliente: 'RAP002', cuit: '', condicionIva: '',
    })
  })

  it('venta a una sucursal con ficha de Tango: nombre comercial, domicilio, C.P. y código de la sucursal', () => {
    expect(clienteImpreso(venta({ clienteCodigoTango: 'RAP002' }), rappi)).toMatchObject({
      razonSocial: 'RAPPI ARG S.A.S.',            // la del CUIT, no la de la sucursal
      sucursal: 'RAPPI HUMBOLDT (RAP002)',
      domicilio: 'HUMBOLDT 1877',
      localidadCp: '1414, PALERMO',
      codigoCliente: 'RAP002',
      cuit: '30-71234567-8',
    })
  })

  it('sucursal con dato viejo (sin campos Tango): la dirección plana y sin C.P.', () => {
    expect(clienteImpreso(venta({ clienteCodigoTango: 'RAP001' }), rappi)).toMatchObject({
      sucursal: 'GASTRONOMIA (MONROE) (RAP001)', domicilio: 'Monroe 1616, CABA, Capital Federal', localidadCp: '', codigoCliente: 'RAP001',
    })
  })

  it('venta al código principal de una cuenta con sucursales: línea Sucursal con el código, datos de la central', () => {
    expect(clienteImpreso(venta({ clienteCodigoTango: 'MDP203' }), rappi)).toMatchObject({
      sucursal: 'MDP203', domicilio: 'Belgrano 3434, Mar del Plata, Buenos Aires', localidadCp: '7600, MAR DEL PLATA', codigoCliente: 'MDP203',
    })
  })

  it('código que todavía no está en addresses: solo el código, datos de la central', () => {
    expect(clienteImpreso(venta({ clienteCodigoTango: 'RAP033' }), rappi)).toMatchObject({
      sucursal: 'RAP033', domicilio: 'Belgrano 3434, Mar del Plata, Buenos Aires', codigoCliente: 'RAP033',
    })
  })

  it('en promo mira los códigos de Rolito: con uno solo no hay línea Sucursal aunque en Redonhielo tenga tres', () => {
    const r = clienteImpreso(venta({ canal: 'promo', clienteCodigoTango: 'RAP001' }), rappi)
    expect(r.sucursal).toBe('')
    expect(r.codigoCliente).toBe('RAP001')
    // RAP001 no es el principal de Rolito... sí lo es (único código): datos de la central.
    expect(r.domicilio).toBe('Belgrano 3434, Mar del Plata, Buenos Aires')
  })

  it('cuenta de un solo código: igual que hoy, con el código de la venta', () => {
    const kiosco = { uid: 'k', razonSocial: 'KIOSCO PEPE', cuit: '20-1-1', address: 'Mitre 100', codigoTango: 'FC.900', idGva14Tango: 5, localidadTango: 'MERLO', codigoPostalTango: '1722',
      addresses: [dir('FC.900', 'Principal', 'Mitre 100, Merlo', { domicilioTango: 'MITRE 100', localidadTango: 'MERLO', codigoPostalTango: '1722' })] } as unknown as UserProfile
    expect(clienteImpreso(venta({ clienteCodigoTango: 'FC.900' }), kiosco)).toMatchObject({ sucursal: '', domicilio: 'MITRE 100', localidadCp: '1722, MERLO', codigoCliente: 'FC.900' })
  })

  it('cliente sin Tango: código de la app y sin sucursal', () => {
    const app = { uid: 'a', razonSocial: 'SIN TANGO', cuit: '', address: 'Alsina 5', codigoCliente: 'C-7', addresses: [] } as unknown as UserProfile
    expect(clienteImpreso(venta(), app)).toMatchObject({ sucursal: '', domicilio: 'Alsina 5', localidadCp: '', codigoCliente: 'C-7' })
  })

  it('nombre de la sucursal: comercial > razón social del código > nombre de la app > solo el código', () => {
    expect(nombreImpresoSucursal(dir('X1', 'Principal', '', { nombreComercialTango: 'YPF RUTA 8', razonSocialTango: 'OPESSA' }), 'X1')).toBe('YPF RUTA 8 (X1)')
    expect(nombreImpresoSucursal(dir('X1', 'Suc. Norte', '', { razonSocialTango: 'OPESSA' }), 'X1')).toBe('OPESSA (X1)')
    expect(nombreImpresoSucursal(dir('X1', 'Suc. Norte', ''), 'X1')).toBe('Suc. Norte (X1)')
    expect(nombreImpresoSucursal(dir('X1', 'Principal', ''), 'X1')).toBe('X1')
    expect(nombreImpresoSucursal(dir('X1', 'X1', ''), 'X1')).toBe('X1')
    expect(nombreImpresoSucursal(undefined, 'X1')).toBe('X1')
  })
})
