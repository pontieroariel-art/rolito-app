import type { EmpresaTango } from '@/types'

// Cliente inhabilitado en una empresa de Tango (2026-09-11). La sync diaria
// escribe `users.habilitadoTango.{redonhielo,rolito}`; si está inhabilitado en
// las dos la cuenta pasa a inactiva, pero si lo está en UNA sigue activa (vende
// en la otra) y hay que frenar la venta en esa empresa: contado y cta. cte.
// van a Redonhielo, promo a Rolito. Ausente = habilitado (cuentas sin sync).

export const NOMBRE_EMPRESA: Record<EmpresaTango, string> = { redonhielo: 'Redonhielo', rolito: 'Rolito' }

type ConHabilitacion = { habilitadoTango?: Partial<Record<EmpresaTango, boolean>> | null }

export const inhabilitadoEnTango = (c: ConHabilitacion | null | undefined, empresa: EmpresaTango): boolean =>
  c?.habilitadoTango?.[empresa] === false

/** Empresas donde está inhabilitado, en orden fijo (para etiquetas y el índice). */
export const empresasInhabilitado = (c: ConHabilitacion | null | undefined): EmpresaTango[] =>
  (['redonhielo', 'rolito'] as const).filter((e) => inhabilitadoEnTango(c, e))

/** "Inhabilitado en Redonhielo" / "Inhabilitado en Tango" (las dos) / '' (ninguna). */
export function etiquetaInhabilitado(empresas: EmpresaTango[] | undefined | null): string {
  if (!empresas?.length) return ''
  return empresas.length >= 2 ? 'Inhabilitado en Tango' : `Inhabilitado en ${NOMBRE_EMPRESA[empresas[0]]}`
}

/** Aviso para quien vende: por qué no se le puede vender en esa empresa. */
export const motivoInhabilitado = (empresa: EmpresaTango): string =>
  `Este cliente está inhabilitado en Tango (${NOMBRE_EMPRESA[empresa]}). No se le puede vender hasta que la oficina lo habilite de nuevo.`
