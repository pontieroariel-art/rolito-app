import { describe, expect, it } from 'vitest'
import { productosFabricaTopeados } from './entregaFabricaTope'

const e = (productoId: string, cantidad: number) => ({ productoId, nombre: productoId, cantidad })

describe('productosFabricaTopeados (auditoría chofer C4)', () => {
  it('lo entregado dentro de lo pedido no cambia', () => {
    const r = productosFabricaTopeados([{ quantity: 100, productoId: 'b2' }], [e('b2', 80)])
    expect(r.productos[0]!.cantidad).toBe(80)
    expect(r.excedido).toBe(false)
  })
  it('una cantidad inflada se topea a lo pedido', () => {
    const r = productosFabricaTopeados([{ quantity: 100, productoId: 'b2' }], [e('b2', 900)])
    expect(r.productos[0]!.cantidad).toBe(100)
    expect(r.excedido).toBe(true)
  })
  it('un producto que el pedido no tiene va a cero si no hay renglones sin código', () => {
    const r = productosFabricaTopeados([{ quantity: 100, productoId: 'b2' }], [e('b2', 100), e('b10', 50)])
    expect(r.productos.map((p) => p.cantidad)).toEqual([100, 0])
    expect(r.excedido).toBe(true)
  })
  it('pedidos cargados por nombre: usa las unidades de los renglones sin código', () => {
    const r = productosFabricaTopeados([{ quantity: 60 }], [e('b2', 40), e('b3', 30)])
    expect(r.productos.map((p) => p.cantidad)).toEqual([40, 20])
  })
  it('el mismo producto repetido no suma dos veces el tope', () => {
    const r = productosFabricaTopeados([{ quantity: 100, productoId: 'b2' }], [e('b2', 70), e('b2', 70)])
    expect(r.productos.map((p) => p.cantidad)).toEqual([70, 30])
  })
  it('sin pedido ni entrega, nada', () => {
    expect(productosFabricaTopeados(null, null)).toEqual({ productos: [], excedido: false })
  })
})

