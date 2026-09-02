// Artículos de cambio.
//
// Un cambio es la bolsa rota del cliente por una nueva, sin cargo. Deja de ser
// un registro aparte para pasar a ser un RENGLÓN del documento que salga de la
// operación: la factura si se cobró en efectivo o transferencia, el remito si
// va a cuenta corriente. Igual para las dos empresas (Redonhielo/contado y
// Rolito/promo).
//
// Cada producto del catálogo tiene su artículo de cambio, derivado del propio
// producto en vez de cargado a mano: así no se pueden desincronizar, y agregar
// un producto nuevo trae su cambio sin que nadie se acuerde de crearlo.
//
// **Siempre valen $0.** No suman al total ni a lo que se le declara a ARCA
// (WSFEv1 no lleva renglones: solo importes, así que un cambio es invisible
// para ARCA por construcción). Están en el papel para que quede constancia de
// qué se entregó y qué se retiró.

import { CatalogProducto, VentaCamionItem } from '../types'

export const PREFIJO_CAMBIO = 'cambio_'

/** `bolsa_2kg` → `cambio_bolsa_2kg`. */
export function idCambio(productoId: string): string {
  return `${PREFIJO_CAMBIO}${productoId}`
}

export function esIdCambio(id: string): boolean {
  return String(id ?? '').startsWith(PREFIJO_CAMBIO)
}

/** `cambio_bolsa_2kg` → `bolsa_2kg`. Devuelve el id tal cual si no es un cambio. */
export function productoDelCambio(id: string): string {
  return esIdCambio(id) ? id.slice(PREFIJO_CAMBIO.length) : id
}

export function nombreCambio(nombreProducto: string): string {
  return `Cambio ${nombreProducto}`
}

/** `Cambio Hielo bolsa 2kg` → `Hielo bolsa 2kg`. Para volver a agrupar por producto. */
export function nombreDelCambio(nombre: string): string {
  const n = String(nombre ?? '')
  return n.startsWith('Cambio ') ? n.slice('Cambio '.length) : n
}

/**
 * El catálogo de cambios, uno por producto.
 *
 * Conserva la foto y el color para que la botonera de cambios se vea igual que
 * la de venta — el chofer reconoce el producto por la imagen, no por el texto.
 */
export function articulosDeCambio(catalogo: CatalogProducto[]): CatalogProducto[] {
  return catalogo
    // Un catálogo no debería traer ids con el prefijo, pero si alguien los
    // carga a mano, no queremos un `cambio_cambio_…`.
    .filter((p) => !esIdCambio(p.id))
    .map((p) => ({ ...p, id: idCambio(p.id), nombre: nombreCambio(p.nombre) }))
}

/** Cantidades de la botonera de cambios → renglones, siempre en $0. */
export function itemsDeCambio(
  articulos: CatalogProducto[],
  cantidades: Record<string, number>,
): VentaCamionItem[] {
  return articulos
    .map((a) => ({
      productoId:     a.id,
      nombre:         a.nombre,
      cantidad:       cantidades[a.id] ?? 0,
      precioUnitario: 0,
    }))
    .filter((i) => i.cantidad > 0)
}
