// Las dos empresas de Tango y la identidad de un cliente en cada una.
//
// Redonhielo (Company 1, la oficial) y Rolito (Company 3, la promo) son bases
// separadas: un mismo cliente tiene en cada una su propio ID_GVA14 y, casi
// siempre, el mismo COD_GVA14. Desde el 2026-09-06 (decisión de Ariel: "Tango
// es la base maestra, las dos empresas") la ficha del cliente guarda la
// identidad por empresa en `tangoIds`:
//
//   users/{uid}.tangoIds = { redonhielo: [{ idGva14, codigo }], rolito: [{...}] }
//
// Es un array por empresa porque un CUIT puede tener varios códigos en Tango
// (sucursales / grupos empresarios) y la app tiene UNA cuenta por CUIT; el
// primero es el principal. Los campos viejos `idGva14Tango` / `codigoTango`
// siguen existiendo como alias del principal de Redonhielo (los usan precios,
// los writers de facturas, la UI); `tangoIdsDe` los absorbe cuando la ficha
// todavía no tiene `tangoIds` (cuentas que la sync no volvió a tocar).

export const EMPRESAS = ['redonhielo', 'rolito'] as const
export type Empresa = (typeof EMPRESAS)[number]

export const NOMBRE_EMPRESA: Record<Empresa, string> = { redonhielo: 'Redonhielo S.A.', rolito: 'Rolito' }

export interface TangoIdEmpresa {
  idGva14: number
  codigo:  string
}

export type TangoIds = Partial<Record<Empresa, TangoIdEmpresa[]>>

export const esEmpresa = (v: unknown): v is Empresa => v === 'redonhielo' || v === 'rolito'

type PerfilConTango = {
  tangoIds?:     unknown
  idGva14Tango?: unknown
  codigoTango?:  unknown
}

function limpiarLista(v: unknown): TangoIdEmpresa[] {
  if (!Array.isArray(v)) return []
  const out: TangoIdEmpresa[] = []
  for (const x of v) {
    const idGva14 = Number((x as { idGva14?: unknown })?.idGva14)
    const codigo = String((x as { codigo?: unknown })?.codigo ?? '').trim()
    if (Number.isInteger(idGva14) && idGva14 > 0 && codigo && !out.some((o) => o.idGva14 === idGva14)) out.push({ idGva14, codigo })
  }
  return out
}

/** Identidad Tango por empresa de una ficha, absorbiendo los campos legacy de Redonhielo. */
export function tangoIdsDe(perfil: PerfilConTango | undefined | null): TangoIds {
  const out: TangoIds = {}
  const raw = (perfil?.tangoIds ?? {}) as Record<string, unknown>
  for (const empresa of EMPRESAS) {
    const lista = limpiarLista(raw[empresa])
    if (lista.length) out[empresa] = lista
  }
  const idLegacy = Number(perfil?.idGva14Tango)
  const codLegacy = String(perfil?.codigoTango ?? '').trim()
  if (Number.isInteger(idLegacy) && idLegacy > 0 && codLegacy) {
    const rh = out.redonhielo ?? []
    if (!rh.some((x) => x.idGva14 === idLegacy)) out.redonhielo = [{ idGva14: idLegacy, codigo: codLegacy }, ...rh]
  }
  return out
}

/** ID_GVA14 principal del cliente en una empresa (null si no está vinculado ahí). */
export function idGva14De(perfil: PerfilConTango | undefined | null, empresa: Empresa): number | null {
  return tangoIdsDe(perfil)[empresa]?.[0]?.idGva14 ?? null
}

/** COD_GVA14 principal del cliente en una empresa (null si no está vinculado ahí). */
export function codigoTangoDe(perfil: PerfilConTango | undefined | null, empresa: Empresa): string | null {
  return tangoIdsDe(perfil)[empresa]?.[0]?.codigo ?? null
}

/** Agrega (o reordena como principal) una identidad en la lista de una empresa; devuelve la lista nueva. */
export function agregarTangoId(actual: TangoIdEmpresa[] | undefined, nuevo: TangoIdEmpresa, opts: { principal?: boolean } = {}): TangoIdEmpresa[] {
  const sin = (actual ?? []).filter((x) => x.idGva14 !== nuevo.idGva14)
  return opts.principal ? [nuevo, ...sin] : [...sin, nuevo]
}
