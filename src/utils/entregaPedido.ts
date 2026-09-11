import type { EmpresaTango, FormaPago, OrderProduct, UserProfile } from '@/types'
import { normalizarBusqueda } from './busqueda'
import { admiteCuentaCorriente } from './condicionVenta'
import { sucursalesDe } from './sucursalesTango'

// Entregar un pedido de logística desde el celular del chofer (2026-09-11):
// la app arma la venta con lo que ya sabe del pedido y el chofer solo confirma
// cantidades, elige canal y forma de pago y pide la firma. Puro, sin Firebase.

export interface RenglonEntrega {
  /** id del catálogo (el que usan precios y Tango); '' si el producto del pedido no se reconoció. */
  productoId: string
  nombre:     string
  /** Lo que pidió el cliente. */
  pedido:     number
  /** Lo que se entrega (arranca igual al pedido). */
  cantidad:   number
}

/**
 * Renglones de la entrega a partir de los productos del pedido, resueltos
 * contra el catálogo por `productoId` o, si el pedido viejo no lo trae, por
 * nombre (sin acentos ni mayúsculas). Un producto que no está en el catálogo
 * queda con productoId '' para que la pantalla lo diga.
 */
export function renglonesDelPedido(products: OrderProduct[], catalogo: { id: string; nombre: string }[]): RenglonEntrega[] {
  const porNombre = new Map(catalogo.map((c) => [normalizarBusqueda(c.nombre), c]))
  return products
    .filter((p) => p.quantity > 0)
    .map((p) => {
      const c = (p.productoId && catalogo.find((x) => x.id === p.productoId)) || porNombre.get(normalizarBusqueda(p.name))
      return { productoId: c?.id ?? '', nombre: c?.nombre ?? p.name, pedido: p.quantity, cantidad: p.quantity }
    })
}

/** ¿Entregó menos de lo pedido en algún renglón? */
export const esEntregaParcial = (r: RenglonEntrega[]): boolean => r.some((x) => x.cantidad < x.pedido)

/**
 * Sucursal (código de Tango) a la que fue el pedido: la dirección del pedido
 * contra las direcciones de la cuenta en esa empresa. Sin coincidencia, '' (la
 * pantalla pide elegir si la cuenta tiene varias).
 */
export function sucursalDelPedido(
  cliente: Pick<UserProfile, 'idGva14Tango' | 'codigoTango' | 'tangoIds' | 'addresses'> | undefined,
  empresa: EmpresaTango,
  clientAddress: string | undefined,
): string {
  if (!cliente) return ''
  const lista = sucursalesDe(cliente, empresa)
  if (lista.length <= 1) return lista[0]?.codigo ?? ''
  const buscada = normalizarBusqueda(clientAddress ?? '')
  if (!buscada) return ''
  return lista.find((s) => normalizarBusqueda(s.address ?? '') === buscada)?.codigo ?? ''
}

/** Forma de pago con la que arranca la pantalla: la habitual del cliente en Tango. */
export function formaPagoInicial(cliente: { condicionVenta?: string } | undefined): FormaPago {
  return admiteCuentaCorriente(cliente).ok ? 'cuenta_corriente' : 'contado_efectivo'
}
