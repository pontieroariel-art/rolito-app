import type { ComprobanteSaldoTango, EmpresaTango } from '@/types'
import { EMPRESAS_TANGO } from './tangoEmpresas'
import { sumaCentavos } from './money'

// Composición de saldos de un cliente, agrupada por empresa de Tango y código
// de cliente (un CUIT puede tener varios códigos y deuda en Redonhielo y en
// Rolito). Lo usan la pantalla de cobro (un recibo = un bloque), la ficha del
// cliente y el PDF de composición de saldos. Puro, sin Firebase.

/** Los docs anteriores al 2026-09-06 no traen empresa: son de Redonhielo. */
export const empresaDe = (c: ComprobanteSaldoTango): EmpresaTango => c.empresa ?? 'redonhielo'

/** La misma factura (tipo + número) puede existir en las dos empresas: la clave lleva empresa y código. */
export const claveComp = (c: ComprobanteSaldoTango) => `${empresaDe(c)}|${c.codigoTango ?? ''}|${c.tipo}|${c.numero}`

export interface GrupoRecibo { empresa: EmpresaTango; codigo: string }
export const grupoDe = (c: ComprobanteSaldoTango): GrupoRecibo => ({ empresa: empresaDe(c), codigo: c.codigoTango ?? '' })
export const mismoGrupo = (a: GrupoRecibo, b: GrupoRecibo) => a.empresa === b.empresa && a.codigo === b.codigo

export interface BloqueSaldo { grupo: GrupoRecibo; comprobantes: ComprobanteSaldoTango[]; subtotal: number }

/** Bloques por empresa (en el orden de EMPRESAS_TANGO) y, dentro, por código de cliente. */
export function agruparPorEmpresaYCodigo(comprobantes: ComprobanteSaldoTango[]): BloqueSaldo[] {
  const out: BloqueSaldo[] = []
  for (const empresa of EMPRESAS_TANGO) {
    const deEmpresa = comprobantes.filter((c) => empresaDe(c) === empresa)
    const codigos = [...new Set(deEmpresa.map((c) => c.codigoTango ?? ''))]
    for (const codigo of codigos) {
      const lista = deEmpresa.filter((c) => (c.codigoTango ?? '') === codigo)
      out.push({ grupo: { empresa, codigo }, comprobantes: lista, subtotal: sumaCentavos(lista.map((c) => c.saldoPendiente)) / 100 })
    }
  }
  return out
}

/** Días de atraso de la factura más vieja (0 si nada venció). */
export const atrasoMaximo = (comprobantes: ComprobanteSaldoTango[]): number =>
  Math.max(0, ...comprobantes.map((c) => c.diasAtraso ?? 0))
