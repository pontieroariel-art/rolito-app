// Entrega con remito de fábrica (2026-09-23, decisión de Ariel para Coto y
// Carrefour): la oficina emite el remito en Tango desde el depósito del chofer
// antes de que salga el camión, así que el pedido se entrega SIN comprobante
// de la app. Lo que sí tiene que pasar es que la mercadería descuente del
// camión, porque si no el conteo del muelle da faltante y el servidor manda
// al 98 una diferencia que en Tango sería doble.
//
// Acá vive la parte pura: qué pedidos van por este camino, cómo se arma la
// entrega que escribe el chofer y a qué viaje pertenece cada una.
import type { Timestamp } from 'firebase/firestore'
import type { EntregaFabrica, Order, OrderProduct, RemitoCarga } from '@/types'
import { viajeDeVenta } from './viajeDeVenta'

/** El pedido se entrega sin comprobante de la app (sellado por el servidor al crearse). */
export const esEntregaSinComprobante = (order: Pick<Order, 'entregaSinComprobante' | 'clientId'>): boolean =>
  order.entregaSinComprobante === true && !!order.clientId && order.clientId !== 'externo'

export interface RenglonFabrica { productoId: string; nombre: string; cantidad: number }

/**
 * Renglones de la entrega: solo productos del catálogo con cantidad. Un pedido
 * de Coto puede traer un renglón que la app no reconoce; se descarta, porque
 * sin productoId no descuenta de ninguna fila de la carga.
 */
export function renglonesFabrica(entregados: OrderProduct[]): RenglonFabrica[] {
  return entregados
    .filter((p) => !!p.productoId && p.quantity > 0)
    .map((p) => ({ productoId: p.productoId!, nombre: p.name, cantidad: p.quantity }))
}

/**
 * La entrega que se guarda en el pedido. El viaje es el remito de carga con el
 * que el chofer salió (el mismo del que ya sale la venta); sin remito queda
 * `null` y se ubica por chofer y día.
 */
export function armarEntregaFabrica(
  entregados: OrderProduct[],
  chofer: { uid: string; nombre: string; camionId?: string | null },
  viaje: Pick<RemitoCarga, 'id' | 'codigo' | 'camionId'> | null | undefined,
  ahora: Timestamp,
  dia: string,
): EntregaFabrica {
  return {
    choferId:     chofer.uid,
    choferNombre: chofer.nombre,
    remitoId:     viaje?.id ?? null,
    remitoCodigo: viaje?.codigo ?? null,
    camionId:     viaje?.camionId ?? chofer.camionId ?? null,
    dia,
    en:           ahora,
    productos:    renglonesFabrica(entregados),
  }
}

/**
 * Las entregas de un viaje, con el mismo criterio que `ventasDelViaje`: por
 * `remitoId` cuando lo trae, y por camión y día cuando no (chofer que salió sin
 * remito propio). Sin viaje elegido (cobrador, día sin remito) entran todas.
 */
export function entregasFabricaDelViaje(
  pedidos: Pick<Order, 'entregaFabrica'>[],
  viajesDelChofer: Pick<RemitoCarga, 'id' | 'camionId' | 'choferId' | 'fecha'>[],
  viajeId: string | null,
): EntregaFabrica[] {
  const entregas = pedidos.map((p) => p.entregaFabrica).filter((e): e is EntregaFabrica => !!e)
  if (!viajeId) return entregas
  return entregas.filter((e) => viajeDeVenta({ remitoId: e.remitoId ?? undefined, camionId: e.camionId ?? undefined, choferId: e.choferId, fecha: e.en }, viajesDelChofer) === viajeId)
}

/** Total de unidades de una lista de entregas (para chips y resúmenes). */
export const unidadesEntregadas = (entregas: Pick<EntregaFabrica, 'productos'>[]): number =>
  entregas.reduce((s, e) => s + e.productos.reduce((x, p) => x + p.cantidad, 0), 0)

/**
 * Tope de la entrega con remito de fábrica a lo que tenía el pedido (2026-09-26,
 * auditoría del chofer, C4). Las reglas no pueden comparar las cantidades
 * contra el pedido, así que el que la lee (la cuenta de mercadería del viaje,
 * la revisión de la descarga y lo que va al 98 en Tango) nunca toma más de lo
 * pedido: una cantidad inflada hacía "desaparecer" mercadería sin faltante.
 * Un producto que el pedido no tiene por código solo puede usar las unidades
 * de los renglones del pedido que no traen código (pedidos cargados por nombre).
 * Lo que excede queda como faltante en la descarga, que es donde se controla.
 */
/** El pedido con su entrega de fábrica topeada a lo pedido (ver productosFabricaTopeados). */
export function conEntregaFabricaTopeada<T extends { products?: OrderProduct[]; entregaFabrica?: EntregaFabrica | null }>(o: T): T {
  if (!o.entregaFabrica) return o
  return { ...o, entregaFabrica: { ...o.entregaFabrica, productos: productosFabricaTopeados(o.products, o.entregaFabrica.productos).productos } }
}

export function productosFabricaTopeados(
  pedido: { quantity?: unknown; productoId?: unknown }[] | null | undefined,
  entregados: { productoId: string; nombre: string; cantidad: number }[] | null | undefined,
): { productos: { productoId: string; nombre: string; cantidad: number }[]; excedido: boolean } {
  const porId = new Map<string, number>()
  let sinCodigo = 0
  for (const p of pedido ?? []) {
    const q = Number(p?.quantity) || 0
    if (q <= 0) continue
    if (typeof p.productoId === 'string' && p.productoId) porId.set(p.productoId, (porId.get(p.productoId) ?? 0) + q)
    else sinCodigo += q
  }
  let excedido = false
  const productos = (entregados ?? []).map((e) => {
    const pedida = porId.get(e.productoId)
    let tope: number
    if (pedida !== undefined) { tope = pedida; porId.set(e.productoId, 0) } else { tope = sinCodigo; sinCodigo = 0 }
    const cantidad = Math.max(0, Math.min(Number(e.cantidad) || 0, tope))
    if (cantidad !== e.cantidad) excedido = true
    if (pedida !== undefined) porId.set(e.productoId, Math.max(0, pedida - cantidad))
    else sinCodigo = Math.max(0, tope - cantidad)
    return { ...e, cantidad }
  })
  return { productos, excedido }
}
