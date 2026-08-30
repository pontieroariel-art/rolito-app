import { describe, it, expect } from 'vitest'
import { precioEfectivo, palletsInfo, calcPallets } from './helpers'
import { CatalogProducto, OrderProduct, UserProfile } from '../types'

// precioEfectivo, palletsInfo y calcPallets tocan plata y envases; se testean
// como funciones puras (helpers no arrastra la inicialización de Firebase).

// precioEfectivo solo lee preciosCustom/vigenciaCustom del perfil; el resto de
// UserProfile no interviene, así que se arma un perfil mínimo para el caso.
function perfil(
  preciosCustom?: Record<string, number>,
  vigenciaCustom?: Record<string, string>,
): UserProfile {
  return { preciosCustom, vigenciaCustom } as unknown as UserProfile
}

const producto = (unidadesPorPallet?: number): CatalogProducto =>
  ({ id: 'hielo10', nombre: 'Hielo 10kg', unidad: 'bolsa', unidadesPorPallet })

describe('precioEfectivo', () => {
  it('sin precio especial devuelve el precio de lista', () => {
    expect(precioEfectivo(perfil(), 'hielo10', 500)).toBe(500)
  })

  it('con precio especial vigente (sin fecha de vencimiento) devuelve el especial', () => {
    expect(precioEfectivo(perfil({ hielo10: 420 }), 'hielo10', 500)).toBe(420)
  })

  it('con precio especial y vigencia futura devuelve el especial', () => {
    expect(precioEfectivo(perfil({ hielo10: 420 }, { hielo10: '2999-12-31' }), 'hielo10', 500)).toBe(420)
  })

  it('con precio especial vencido vuelve al precio de lista', () => {
    expect(precioEfectivo(perfil({ hielo10: 420 }, { hielo10: '2000-01-01' }), 'hielo10', 500)).toBe(500)
  })

  it('un precio especial de otro producto no afecta a este', () => {
    expect(precioEfectivo(perfil({ hielo5: 200 }), 'hielo10', 500)).toBe(500)
  })
})

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
