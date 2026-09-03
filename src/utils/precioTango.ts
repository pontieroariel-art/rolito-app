// Resolución del precio de un producto para un cliente con los datos de Tango
// (Tango es la fuente maestra de listas y precios, decisión 2026-09-03).
//
//   1. precio ESPECIAL del cliente para ese producto (GVA13 en Tango), si hay;
//   2. si no, el precio de la LISTA que el cliente tiene asignada en esa
//      empresa (users.listaTango[empresa] → preciosTango/{empresa}.listas);
//   3. si no hay precio → null: el producto no se puede vender. No se inventa
//      $0 ni se cae a las listas viejas de la app.
//
// La empresa la decide el canal: contado → Redonhielo, promo → Rolito.

import type { CanalVenta, UserProfile } from '../types'

export type EmpresaTango = 'redonhielo' | 'rolito'

export interface ListaTango {
  nombre: string
  incluyeIva: boolean
  precios: Record<string, number>
}

export interface PreciosTango {
  company?: number
  productos?: Record<string, string>
  listas: Record<string, ListaTango>
  especiales: Record<string, Record<string, number>>
  actualizadoEn?: unknown
}

// En Tango un artículo sin precio en una lista figura con PRECIO = 0 (por ej.
// "barra" en la lista 1 de Rolito). Cero no es un precio: no se vende gratis.
const esPrecioValido = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0

export function empresaDeCanal(canal: CanalVenta | null | undefined): EmpresaTango {
  return canal === 'promo' ? 'rolito' : 'redonhielo'
}

/** Firestore no admite '.' en claves: 'FC.280' → 'FC_280' (igual que en la sync). */
export const claveClienteTango = (codigoTango: string) => String(codigoTango).replace(/\./g, '_')

export interface PrecioResuelto {
  precio: number
  origen: 'especial' | 'lista'
  lista?: { nro: number; nombre: string }
}

export function precioTangoDe(
  precios: PreciosTango | null | undefined,
  cliente: Pick<UserProfile, 'codigoTango' | 'listaTango'> | null | undefined,
  empresa: EmpresaTango,
  productoId: string,
): PrecioResuelto | null {
  if (!precios || !cliente) return null
  const cod = cliente.codigoTango?.trim()
  if (cod) {
    const especial = precios.especiales?.[claveClienteTango(cod)]?.[productoId]
    if (esPrecioValido(especial)) return { precio: especial, origen: 'especial' }
  }
  const nro = cliente.listaTango?.[empresa]
  if (!nro) return null
  const lista = precios.listas?.[String(nro)]
  const precio = lista?.precios?.[productoId]
  if (!esPrecioValido(precio)) return null
  return { precio, origen: 'lista', lista: { nro, nombre: lista.nombre } }
}

/** Por qué un cliente no tiene precio: para el aviso en pantalla. */
export function motivoSinPrecioTango(
  precios: PreciosTango | null | undefined,
  cliente: Pick<UserProfile, 'codigoTango' | 'listaTango'> | null | undefined,
  empresa: EmpresaTango,
): string | null {
  if (!precios) return 'Todavía no se sincronizaron los precios desde Tango.'
  if (!cliente) return null
  if (!cliente.codigoTango) return 'Este cliente no está vinculado a Tango (sin código de cliente).'
  if (!cliente.listaTango?.[empresa]) return `Este cliente no tiene lista de precios asignada en Tango (${empresa === 'rolito' ? 'Rolito' : 'Redonhielo'}).`
  if (!precios.listas?.[String(cliente.listaTango[empresa])]) return `La lista ${cliente.listaTango[empresa]} del cliente no existe en Tango (${empresa === 'rolito' ? 'Rolito' : 'Redonhielo'}).`
  return null
}
