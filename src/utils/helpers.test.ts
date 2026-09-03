import { describe, it, expect } from 'vitest'
import { palletsInfo, calcPallets } from './helpers'
import { CatalogProducto, OrderProduct } from '../types'

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
