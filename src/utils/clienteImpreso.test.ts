import { describe, expect, it } from 'vitest'
import { clienteImpreso, nombreImpresoSucursal, razonSocialFiscal } from './clienteImpreso'
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

  it('caso real (OPERADORA SAN JUAN): el nombre comercial repite la cuenta, la razón social del código trae la sucursal', () => {
    const cuenta = 'OPERADORA SAN JUAN S.A.EN FORM'
    // NOM_COM igual a la cuenta (con un punto de diferencia) → se descarta; gana la razón social del código.
    expect(nombreImpresoSucursal(dir('MDP202', 'OPERADORA SAN JUAN SA EN FORMA ( COLON)', '', { nombreComercialTango: 'OPERADORA SAN JUAN S.A EN FORM', razonSocialTango: 'OPERADORA SAN JUAN SA EN FORMA ( COLON)' }), 'MDP202', cuenta))
      .toBe('OPERADORA SAN JUAN SA EN FORMA ( COLON) (MDP202)')
    expect(nombreImpresoSucursal(dir('MDP198', 'x', '', { nombreComercialTango: cuenta, razonSocialTango: 'OPERADORA SAN JUAN S.A.EN FORMACION - (ONIGLIA)' }), 'MDP198', cuenta))
      .toBe('OPERADORA SAN JUAN S.A.EN FORMACION - (ONIGLIA) (MDP198)')
    // Los dos iguales a la cuenta y el nombre de la app también → solo el código (lo distingue el domicilio).
    expect(nombreImpresoSucursal(dir('MDP183', cuenta, '', { nombreComercialTango: cuenta, razonSocialTango: cuenta }), 'MDP183', cuenta)).toBe('MDP183')
    // Cuando el comercial sí distingue (YPF), gana aunque la razón social del código también sea distinta.
    expect(nombreImpresoSucursal(dir('YPF012', 'x', '', { nombreComercialTango: 'YPF RUTA 8 KM 40', razonSocialTango: 'OPESSA - RUTA 8' }), 'YPF012', 'OPERADORA DE ESTACIONES DE SERVICIO S.A.')).toBe('YPF RUTA 8 KM 40 (YPF012)')
  })

  it('caso real (Delivery Hero): todos los códigos llevan el barrio, incluido el principal → SEÑOR(ES) sin barrio y sucursal corta', () => {
    const suc = (id: string, barrio: string, dom: string) => dir(id, `DELIVERY HERO E-COMMERCE SA (${barrio})`, '', {
      razonSocialTango: `DELIVERY HERO E-COMMERCE SA (${barrio})`, nombreComercialTango: `DELIVERY HERO E-COMMERCE SA (${barrio})`, domicilioTango: dom, localidadTango: 'CAPITAL FEDERAL', codigoPostalTango: '1428',
    })
    const dh = {
      uid: 'dh', razonSocial: 'DELIVERY HERO E-COMMERCE SA (NUÑEZ)', cuit: '30-71198576-6', address: 'AMENABAR 2935, CAPITAL FEDERAL',
      codigoTango: 'AL.142', idGva14Tango: 8940, localidadTango: 'CAPITAL FEDERAL', codigoPostalTango: '1428',
      tangoIds: { redonhielo: [{ idGva14: 8940, codigo: 'AL.142' }, { idGva14: 8787, codigo: 'NO.214' }, { idGva14: 9484, codigo: 'FC.530' }] },
      addresses: [suc('AL.142', 'NUÑEZ', 'AMENABAR 2935'), suc('NO.214', 'OLAZABAL', 'MCAL ANTONIO J.DE SUCRE 1530 P'), suc('FC.530', 'RAMOS MEJIA II ', 'MARISCAL A. JOSE DE SUCRE')],
    } as unknown as UserProfile
    expect(razonSocialFiscal(dh)).toBe('DELIVERY HERO E-COMMERCE SA')
    expect(clienteImpreso(venta({ clienteCodigoTango: 'NO.214' }), dh)).toMatchObject({
      razonSocial: 'DELIVERY HERO E-COMMERCE SA', sucursal: 'OLAZABAL (NO.214)', domicilio: 'MCAL ANTONIO J.DE SUCRE 1530 P', localidadCp: '1428, CAPITAL FEDERAL', codigoCliente: 'NO.214',
    })
    // Al principal también le sale su barrio como sucursal (ya no es "la cuenta").
    expect(clienteImpreso(venta({ clienteCodigoTango: 'AL.142' }), dh)).toMatchObject({ razonSocial: 'DELIVERY HERO E-COMMERCE SA', sucursal: 'NUÑEZ (AL.142)', domicilio: 'AMENABAR 2935' })
    expect(clienteImpreso(venta({ clienteCodigoTango: 'FC.530' }), dh).sucursal).toBe('RAMOS MEJIA II (FC.530)')
    // Sin código en la venta: el nombre limpio igual, el resto como siempre.
    expect(clienteImpreso(venta(), dh)).toMatchObject({ razonSocial: 'DELIVERY HERO E-COMMERCE SA', sucursal: '', domicilio: 'AMENABAR 2935, CAPITAL FEDERAL' })
  })

  it('razón social con paréntesis que NO es sucursal se deja como está', () => {
    // Un solo código: no hay con qué confirmar que el paréntesis sea una sucursal.
    expect(razonSocialFiscal({ razonSocial: 'PLACOMGAS S.A.(31 Y 60)', addresses: [dir('X', 'Principal', '', { razonSocialTango: 'PLACOMGAS S.A.(31 Y 60)' })] } as unknown as UserProfile)).toBe('PLACOMGAS S.A.(31 Y 60)')
    // Varias sucursales con otra base: tampoco.
    expect(razonSocialFiscal({ razonSocial: 'GRUPO NORTE (CENTRAL)', addresses: [dir('A', 'x', '', { razonSocialTango: 'GRUPO NORTE (CENTRAL)' }), dir('B', 'x', '', { razonSocialTango: 'KIOSCO EL SOL' }), dir('C', 'x', '', { razonSocialTango: 'ALMACEN DON PEPE' })] } as unknown as UserProfile)).toBe('GRUPO NORTE (CENTRAL)')
    // OPERADORA SAN JUAN: la cuenta no termina en sufijo de sucursal → igual.
    expect(razonSocialFiscal({ razonSocial: 'OPERADORA SAN JUAN S.A.EN FORM', addresses: [] } as unknown as UserProfile)).toBe('OPERADORA SAN JUAN S.A.EN FORM')
    expect(razonSocialFiscal(undefined)).toBe('')
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
