import type { EmpresaTango, TangoIdEmpresa, UserProfile } from '@/types'

// Identidad de un cliente en cada empresa de Tango (espejo de
// functions/src/services/tango/empresas.ts). Un CUIT = una cuenta en la app;
// en cada empresa puede tener varios códigos (sucursales), el primero es el
// principal. Los campos legacy `idGva14Tango` / `codigoTango` siguen siendo el
// principal de Redonhielo para las cuentas que la sync todavía no re-escribió.

export const EMPRESAS_TANGO: EmpresaTango[] = ['redonhielo', 'rolito']

export const NOMBRE_EMPRESA: Record<EmpresaTango, string> = { redonhielo: 'Redonhielo S.A.', rolito: 'Rolito' }
export const NOMBRE_EMPRESA_CORTO: Record<EmpresaTango, string> = { redonhielo: 'Redonhielo', rolito: 'Rolito' }

type PerfilTango = Pick<UserProfile, 'idGva14Tango' | 'codigoTango' | 'tangoIds'>

export function tangoIdsDe(perfil: PerfilTango | null | undefined): Partial<Record<EmpresaTango, TangoIdEmpresa[]>> {
  const out: Partial<Record<EmpresaTango, TangoIdEmpresa[]>> = {}
  for (const empresa of EMPRESAS_TANGO) {
    const lista = (perfil?.tangoIds?.[empresa] ?? []).filter((x) => Number.isInteger(x?.idGva14) && x.idGva14 > 0 && !!x.codigo)
    if (lista.length) out[empresa] = lista
  }
  if (typeof perfil?.idGva14Tango === 'number' && perfil.idGva14Tango > 0 && perfil.codigoTango) {
    const rh = out.redonhielo ?? []
    if (!rh.some((x) => x.idGva14 === perfil.idGva14Tango)) out.redonhielo = [{ idGva14: perfil.idGva14Tango, codigo: perfil.codigoTango }, ...rh]
  }
  return out
}

/** Empresas en las que el cliente está vinculado a Tango (en orden fijo). */
export function empresasVinculadas(perfil: PerfilTango | null | undefined): EmpresaTango[] {
  const ids = tangoIdsDe(perfil)
  return EMPRESAS_TANGO.filter((e) => (ids[e]?.length ?? 0) > 0)
}

export const estaVinculadoATango = (perfil: PerfilTango | null | undefined): boolean => empresasVinculadas(perfil).length > 0

export function codigoTangoDe(perfil: PerfilTango | null | undefined, empresa: EmpresaTango): string | null {
  return tangoIdsDe(perfil)[empresa]?.[0]?.codigo ?? null
}
