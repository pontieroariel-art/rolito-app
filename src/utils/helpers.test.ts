import { describe, it, expect } from 'vitest'
import { palletsInfo, calcPallets, buildCodigoByClientId, buildCodigoByClientIdIndex, getCodigoCliente } from './helpers'
import { CatalogProducto, ClienteIndex, OrderProduct, UserProfile } from '../types'

// palletsInfo y calcPallets tocan envases; se testean
// como funciones puras (helpers no arrastra la inicialización de Firebase).

const producto = (unidadesPorPallet?: number): CatalogProducto =>
  ({ id: 'hielo10', nombre: 'Hielo 10kg', unidad: 'bolsa', unidadesPorPallet })

describe('palletsInfo', () => {
  it('devuelve undefined si el producto no viaja en pallet', () => {
    expect(palletsInfo(producto(undefined), 100)).toBeUndefined()
  })

  it('devuelve undefined para el producto inexistente', () => {
    expect(palletsInfo(undefined, 100)).toBeUndefined()
  })

  it('devuelve undefined para cantidad cero o negativa', () => {
    expect(palletsInfo(producto(88), 0)).toBeUndefined()
    expect(palletsInfo(producto(88), -5)).toBeUndefined()
  })

  it('carga justa: un pallet exacto, sin resto', () => {
    expect(palletsInfo(producto(88), 88)).toEqual({ completos: 1, resto: 0 })
    expect(palletsInfo(producto(88), 176)).toEqual({ completos: 2, resto: 0 })
  })

  it('carga con excedente: floor de pallets y el resto aparte', () => {
    // 90 bolsas con 88 por pallet = 1 pallet + 2 sueltas (no fuerza un 2do pallet)
    expect(palletsInfo(producto(88), 90)).toEqual({ completos: 1, resto: 2 })
  })

  it('menos de un pallet: cero completos, todo va como resto', () => {
    expect(palletsInfo(producto(88), 45)).toEqual({ completos: 0, resto: 45 })
  })
})

describe('calcPallets', () => {
  const catalogo: CatalogProducto[] = [
    { id: 'hielo10', nombre: 'Hielo 10kg', unidad: 'bolsa', unidadesPorPallet: 88 },
    { id: 'hielo5',  nombre: 'Hielo 5kg',  unidad: 'bolsa', unidadesPorPallet: 176 },
    { id: 'seco',    nombre: 'Hielo seco', unidad: 'kg' },   // sin unidadesPorPallet
  ]
  const prod = (productoId: string, name: string, quantity: number): OrderProduct =>
    ({ productoId, name, quantity })

  it('suma la fracción de pallet de cada producto', () => {
    expect(calcPallets([prod('hielo10', 'Hielo 10kg', 44)], catalogo)).toBe(0.5)
    expect(calcPallets([prod('hielo10', 'Hielo 10kg', 88)], catalogo)).toBe(1)
  })

  it('ignora productos que no viajan en pallet', () => {
    expect(calcPallets([prod('seco', 'Hielo seco', 100)], catalogo)).toBe(0)
  })

  it('matchea por nombre cuando no hay productoId', () => {
    expect(calcPallets([{ name: 'Hielo 10kg', quantity: 88 }], catalogo)).toBe(1)
  })

  it('acumula varios productos', () => {
    expect(calcPallets(
      [prod('hielo10', 'Hielo 10kg', 88), prod('hielo5', 'Hielo 5kg', 88)],
      catalogo,
    )).toBe(1.5)
  })
})

describe('buildCodigoByClientId vs buildCodigoByClientIdIndex', () => {
  const ficha = {
    uid: 'u1', codigoCliente: 'FC.280',
    addresses: [
      { id: 'FC.280', nombre: 'Casa central', address: 'Av. Córdoba 123' },
      { id: 'FC.281', nombre: 'Sucursal', address: 'Monroe  45' },
      { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', nombre: 'Nueva', address: 'Calle 1' },
    ],
  } as unknown as UserProfile
  const indice: ClienteIndex = {
    uid: 'u1', razonSocial: 'X', nombreContacto: '', cuit: '', codigoCliente: 'FC.280', codigos: ['FC.280', 'FC.281'],
    sucursales: ['Sucursal'], direccion: 'Av. Córdoba 123', localidad: '', estado: 'activo', vinculadoTango: true,
    domicilios: [
      { id: 'FC.280', nombre: 'Casa central', direccion: 'Av. Córdoba 123', lat: null, lng: null },
      { id: 'FC.281', nombre: 'Sucursal', direccion: 'Monroe  45', lat: null, lng: null },
      { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', nombre: 'Nueva', direccion: 'Calle 1', lat: null, lng: null },
    ],
  }

  it('el índice resuelve los mismos códigos de sucursal que la ficha completa', () => {
    const a = buildCodigoByClientId([ficha])
    const b = buildCodigoByClientIdIndex([indice])
    expect([...b.entries()]).toEqual([...a.entries()])
    expect(getCodigoCliente(b, 'u1', 'monroe 45')).toBe('FC.281')
    expect(getCodigoCliente(b, 'u1', 'calle 1')).toBe('FC.280')   // id random: cae al general
    expect(getCodigoCliente(b, 'u1')).toBe('FC.280')
  })
})
