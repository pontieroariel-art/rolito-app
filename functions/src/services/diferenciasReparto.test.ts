import { describe, it, expect } from 'vitest'
import { faltantesParaTango, rotasPorProductoDe, totalCantidad } from './diferenciasReparto'

// El ejemplo con el que Ariel aprobó la fase B (2026-09-17): un camión sale con
// 100, vende 90, registra 5 cambios y el muelle cuenta 4 sanas.

describe('faltantesParaTango', () => {
  it('ejemplo de Ariel: 100 = 90 + 5 cambios + 4 sanas + 1 → 1 al 98 cuando las rotas cuadran con los cambios', () => {
    const p = [{ productoId: 'bolsa_3kg', nombre: 'Bolsa 3 kg', carga: 100, ventaContado: 60, ventaPromo: 30, cambios: 5, descarga: 4, rotas: 5 }]
    expect(faltantesParaTango(p)).toEqual([{ productoId: 'bolsa_3kg', nombre: 'Bolsa 3 kg', cantidad: 1 }])
  })

  it('con 3 rotas en vez de 5, los dos cambios sin rota son diferencia: 3 al 98 (la app muestra −1)', () => {
    const p = [{ productoId: 'bolsa_3kg', nombre: 'Bolsa 3 kg', carga: 100, ventaContado: 90, ventaPromo: 0, cambios: 5, descarga: 4, rotas: 3 }]
    expect(faltantesParaTango(p)).toEqual([{ productoId: 'bolsa_3kg', nombre: 'Bolsa 3 kg', cantidad: 3 }])
  })

  it('un sobrante no genera movimiento y un producto que cuadra tampoco', () => {
    const p = [
      { productoId: 'a', carga: 10, ventaContado: 5, descarga: 6, rotas: 0 },   // sobrante 1
      { productoId: 'b', carga: 10, ventaContado: 5, descarga: 5, rotas: 0 },   // cuadra
      { productoId: 'c', carga: 10, ventaContado: 5, descarga: 3, rotas: 0 },   // faltan 2
    ]
    expect(faltantesParaTango(p)).toEqual([{ productoId: 'c', nombre: 'c', cantidad: 2 }])
  })

  it('sin `rotas` en el producto (cierre del front viejo) usa las rotas sumadas de las descargas', () => {
    const p = [{ productoId: 'bolsa_3kg', carga: 100, ventaContado: 90, descarga: 4 }]
    expect(faltantesParaTango(p, { bolsa_3kg: 3 })).toEqual([{ productoId: 'bolsa_3kg', nombre: 'bolsa_3kg', cantidad: 3 }])
    expect(faltantesParaTango(p, {})).toEqual([{ productoId: 'bolsa_3kg', nombre: 'bolsa_3kg', cantidad: 6 }])
  })

  it('tolera productos vacíos, campos faltantes y lista undefined', () => {
    expect(faltantesParaTango(undefined)).toEqual([])
    expect(faltantesParaTango([{ productoId: '' }, { productoId: 'x' }])).toEqual([])
  })
})

describe('rotasPorProductoDe / totalCantidad', () => {
  it('suma las rotas de varias descargas por producto', () => {
    const r = rotasPorProductoDe([
      { bolsasRotas: [{ productoId: 'a', cantidad: 2 }, { productoId: 'b', cantidad: 1 }] },
      { bolsasRotas: [{ productoId: 'a', cantidad: 3 }] },
      {},
    ])
    expect(r).toEqual({ a: 5, b: 1 })
  })
  it('totalCantidad ignora cantidades inválidas', () => {
    expect(totalCantidad([{ cantidad: 2 }, { cantidad: 'x' }, {}])).toBe(2)
    expect(totalCantidad(undefined)).toBe(0)
  })
})
