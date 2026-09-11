import { describe, expect, it } from 'vitest'
import type { UserProfile } from '@/types'
import { esEntregaParcial, formaPagoInicial, renglonesDelPedido, sucursalDelPedido } from './entregaPedido'

const catalogo = [{ id: 'bolsa_2kg', nombre: 'Hielo bolsa 2kg' }, { id: 'bolsa_10kg', nombre: 'Hielo bolsa 10kg' }]

describe('renglonesDelPedido', () => {
  it('resuelve por productoId o por nombre; lo que no está en el catálogo queda sin id', () => {
    const r = renglonesDelPedido([
      { name: 'Hielo bolsa 2kg', quantity: 20, productoId: 'bolsa_2kg' },
      { name: 'HIELO BOLSA 10KG', quantity: 5 },
      { name: 'Rolitos premium', quantity: 3 },
      { name: 'Nada', quantity: 0 },
    ], catalogo)
    expect(r).toEqual([
      { productoId: 'bolsa_2kg', nombre: 'Hielo bolsa 2kg', pedido: 20, cantidad: 20 },
      { productoId: 'bolsa_10kg', nombre: 'Hielo bolsa 10kg', pedido: 5, cantidad: 5 },
      { productoId: '', nombre: 'Rolitos premium', pedido: 3, cantidad: 3 },
    ])
  })
  it('parcial cuando algún renglón entrega menos', () => {
    const r = renglonesDelPedido([{ name: 'Hielo bolsa 2kg', quantity: 20 }], catalogo)
    expect(esEntregaParcial(r)).toBe(false)
    expect(esEntregaParcial([{ ...r[0], cantidad: 19 }])).toBe(true)
  })
})

describe('sucursalDelPedido', () => {
  const dir = (id: string, nombre: string, address: string) => ({ id, nombre, address, lat: null, lng: null, horarioApertura: '', horarioCierre: '', contactoNombre: '', contactoTelefono: '', esPrincipal: false })
  const rappi = {
    codigoTango: 'MDP203', idGva14Tango: 10,
    tangoIds: { redonhielo: [{ idGva14: 10, codigo: 'MDP203' }, { idGva14: 11, codigo: 'RAP001' }], rolito: [{ idGva14: 21, codigo: 'RAP001' }] },
    addresses: [dir('MDP203', 'Principal', 'Belgrano 3434, Mar del Plata'), dir('RAP001', 'GASTRONOMIA (MONROE)', 'Monroe 1616')],
  } as unknown as UserProfile
  it('con varias sucursales, la que coincide con la dirección del pedido; sin coincidencia, vacío', () => {
    expect(sucursalDelPedido(rappi, 'redonhielo', 'monroe 1616')).toBe('RAP001')
    expect(sucursalDelPedido(rappi, 'redonhielo', 'Otra calle 1')).toBe('')
    expect(sucursalDelPedido(rappi, 'redonhielo', undefined)).toBe('')
  })
  it('con una sola sucursal, esa; sin cliente, vacío', () => {
    expect(sucursalDelPedido(rappi, 'rolito', 'lo que sea')).toBe('RAP001')
    expect(sucursalDelPedido(undefined, 'rolito', 'x')).toBe('')
  })
})

describe('formaPagoInicial', () => {
  it('cuenta corriente si Tango se la admite, si no contado', () => {
    expect(formaPagoInicial({ condicionVenta: '7 DIAS F.F.' })).toBe('cuenta_corriente')
    expect(formaPagoInicial({ condicionVenta: 'CONTADO' })).toBe('contado_efectivo')
    expect(formaPagoInicial(undefined)).toBe('contado_efectivo')
  })
})
