import type { EmpresaTango, UserProfile } from '@/types'
import { tangoIdsDe } from './tangoEmpresas'

// Sucursales de un cliente en una empresa de Tango (2026-09-08): un CUIT es
// una cuenta en la app, pero en Tango cada sucursal es un código (Rappi tiene
// RAP001…RAP033). Al vender hay que elegir a cuál va la operación, si no
// Tango la carga al código principal (MDP203 en el caso de Rappi). La sync
// deja una dirección por código (addresses[].id = código), de ahí el nombre.

export interface SucursalTango {
  codigo:   string
  idGva14:  number
  nombre:   string   // razón social de la sucursal en Tango, o "Principal"
  address:  string
}

export function sucursalesDe(cliente: Pick<UserProfile, 'idGva14Tango' | 'codigoTango' | 'tangoIds' | 'addresses'> | null | undefined, empresa: EmpresaTango): SucursalTango[] {
  if (!cliente) return []
  const ids = tangoIdsDe(cliente)[empresa] ?? []
  const porCodigo = new Map((cliente.addresses ?? []).map((a) => [a.id, a]))
  return ids.map((x) => {
    const a = porCodigo.get(x.codigo)
    return { codigo: x.codigo, idGva14: x.idGva14, nombre: (a?.nombre || '').trim() || x.codigo, address: (a?.address || '').trim() }
  })
}

/** true si hay que elegir sucursal antes de vender (más de un código en esa empresa). */
export const necesitaSucursal = (cliente: Parameters<typeof sucursalesDe>[0], empresa: EmpresaTango): boolean =>
  sucursalesDe(cliente, empresa).length > 1

/**
 * Nombre y dirección de la sucursal de un código, para mostrar al lado del
 * código en cobranzas y en la ficha ('' si la cuenta tiene un solo código o
 * no se conoce la sucursal).
 */
export function nombreSucursal(cliente: Parameters<typeof sucursalesDe>[0], empresa: EmpresaTango, codigo: string | null | undefined): string {
  const lista = sucursalesDe(cliente, empresa)
  if (lista.length <= 1 || !codigo) return ''
  const s = lista.find((x) => x.codigo === codigo)
  if (!s) return ''
  return [s.nombre !== s.codigo ? s.nombre : '', s.address].filter(Boolean).join(' · ')
}

/** "RAP001 · GASTRONOMIA … (MONROE) · Monroe 1616" */
export function etiquetaSucursal(s: SucursalTango): string {
  const partes = [s.codigo, s.nombre !== s.codigo ? s.nombre : '', s.address].filter(Boolean)
  return partes.join(' · ')
}

/**
 * El cliente con la identidad de la sucursal elegida en los campos legacy que
 * leen crearVentaCamion / crearVentaVentanilla (codigoTango, idGva14Tango).
 * Sin sucursal elegida (cuenta de un solo código) deja el principal de la empresa.
 */
export function clienteEnSucursal<T extends Pick<UserProfile, 'idGva14Tango' | 'codigoTango' | 'tangoIds' | 'addresses'>>(
  cliente: T, empresa: EmpresaTango, codigo: string | null | undefined,
): T & { codigoTango?: string; idGva14Tango?: number } {
  const lista = sucursalesDe(cliente, empresa)
  const s = (codigo ? lista.find((x) => x.codigo === codigo) : undefined) ?? lista[0]
  if (!s) return cliente
  return { ...cliente, codigoTango: s.codigo, idGva14Tango: s.idGva14 }
}
