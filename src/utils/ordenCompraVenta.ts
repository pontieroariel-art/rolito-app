import type { Order } from '@/types'

// Orden de compra del cliente en la venta del camión (2026-09-11). El cliente
// la puede exigir en el remito; la carga el chofer al vender o viene del
// pedido que armó administración (orders.numeroOC). Cuando el chofer elige un
// cliente que tiene un pedido de hoy con OC, se precarga y la venta queda
// vinculada a ese pedido (pedidoId).

const dia = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

/**
 * El pedido de HOY del cliente que corresponde a esta entrega, si hay uno: no
 * cancelado, el más reciente. Los entregados también cuentan (el chofer marca
 * la entrega antes o después de vender, según el caso).
 */
export function pedidoParaVenta(orders: Order[], clienteUid: string, hoy: Date = new Date()): Order | undefined {
  if (!clienteUid) return undefined
  const h = dia(hoy)
  return orders
    .filter((o) => o.clientId === clienteUid && o.status !== 'cancelado' && dia(o.date.toDate()) === h)
    .sort((a, b) => b.date.toMillis() - a.date.toMillis())[0]
}

/** OC normalizada para guardar: sin espacios de más, hasta 40 caracteres, o '' si no hay. */
export const normalizarOrdenCompra = (v: string | null | undefined): string => (v ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
