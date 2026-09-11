import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import type { Order } from '@/types'
import { normalizarOrdenCompra, pedidoParaVenta } from './ordenCompraVenta'

const hoy = new Date('2026-09-11T15:00:00Z')   // 12:00 en Argentina
const pedido = (id: string, over: Partial<Order>): Order =>
  ({ id, clientId: 'c1', status: 'confirmado', date: Timestamp.fromDate(new Date('2026-09-11T11:00:00Z')), numeroOC: `OC-${id}`, ...over }) as unknown as Order

describe('pedidoParaVenta', () => {
  it('toma el pedido de hoy del cliente, el más reciente, y no los cancelados ni los de otro día o cliente', () => {
    const orders = [
      pedido('viejo', { date: Timestamp.fromDate(new Date('2026-09-10T11:00:00Z')) }),
      pedido('temprano', { date: Timestamp.fromDate(new Date('2026-09-11T08:00:00Z')) }),
      pedido('tarde', { date: Timestamp.fromDate(new Date('2026-09-11T13:00:00Z')) }),
      pedido('cancelado', { status: 'cancelado', date: Timestamp.fromDate(new Date('2026-09-11T14:00:00Z')) }),
      pedido('otro', { clientId: 'c2' }),
    ]
    expect(pedidoParaVenta(orders, 'c1', hoy)?.id).toBe('tarde')
    expect(pedidoParaVenta(orders, 'c2', hoy)?.id).toBe('otro')
    expect(pedidoParaVenta(orders, 'c3', hoy)).toBeUndefined()
    expect(pedidoParaVenta(orders, '', hoy)).toBeUndefined()
  })
  it('un pedido entregado también sirve (la OC sigue siendo la del pedido)', () => {
    expect(pedidoParaVenta([pedido('e', { status: 'entregado' })], 'c1', hoy)?.id).toBe('e')
  })
  it('la medianoche se corta en hora argentina', () => {
    // 01:30 del 11/09 en Argentina = 04:30Z: es "hoy"; 23:30 del 10/09 AR = 02:30Z del 11: no.
    expect(pedidoParaVenta([pedido('a', { date: Timestamp.fromDate(new Date('2026-09-11T04:30:00Z')) })], 'c1', hoy)?.id).toBe('a')
    expect(pedidoParaVenta([pedido('b', { date: Timestamp.fromDate(new Date('2026-09-11T02:30:00Z')) })], 'c1', hoy)).toBeUndefined()
  })
})

describe('normalizarOrdenCompra', () => {
  it('recorta espacios y largo', () => {
    expect(normalizarOrdenCompra('  4500  123 ')).toBe('4500 123')
    expect(normalizarOrdenCompra('x'.repeat(50))).toHaveLength(40)
    expect(normalizarOrdenCompra(undefined)).toBe('')
  })
})
