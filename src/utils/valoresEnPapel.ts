import type { ChequeRendido, Cobranza, RetencionRendida } from '@/types'
import { chequesDe, retencionesDe, sumaImportes } from './medios'

// Valores en papel (cheques y certificados de retención) que salen de las
// cobranzas y viajan de mano en mano: cobrador → caja → tesorería. En cada
// paso quien recibe los tilda uno por uno ("recibido" / "no entregado" con
// motivo) — decisión de Ariel 2026-09-09: uno sin decidir bloquea el cierre.
// Todo puro; lo usan la liquidación del repartidor, el cierre de caja de
// ventanilla y la entrega a tesorería.

export interface ChequeEnPapel { cobranzaId: string; numeroRecibo?: string; clienteNombre: string; numero: string; bancoNombre: string; fechaAcreditacion: string; importe: number; esEcheq?: boolean }
export interface RetencionEnPapel { cobranzaId: string; numeroRecibo?: string; clienteNombre: string; tipo: string; nroCertificado: string; importe: number }
export interface ValoresEnPapel { cheques: ChequeEnPapel[]; retenciones: RetencionEnPapel[] }

/** Cheques y certificados de retención de un conjunto de cobranzas. */
export function valoresEnPapel(cobranzas: Cobranza[]): ValoresEnPapel {
  const cheques: ChequeEnPapel[] = []
  const retenciones: RetencionEnPapel[] = []
  for (const c of cobranzas) {
    for (const ch of chequesDe(c)) cheques.push({ cobranzaId: c.id, numeroRecibo: c.numeroRecibo, clienteNombre: c.clienteNombre, numero: ch.numero, bancoNombre: ch.bancoNombre, fechaAcreditacion: ch.fechaAcreditacion, importe: ch.importe, ...(ch.esEcheq ? { esEcheq: true } : {}) })
    for (const r of retencionesDe(c)) retenciones.push({ cobranzaId: c.id, numeroRecibo: c.numeroRecibo, clienteNombre: c.clienteNombre, tipo: r.tipo, nroCertificado: r.nroCertificado, importe: r.importe })
  }
  return { cheques, retenciones }
}

/** Clave estable de un valor (para el estado de tildes en pantalla). */
export const claveCheque = (v: { cobranzaId: string; numero: string }): string => `${v.cobranzaId}|cheque|${v.numero}`
export const claveRetencion = (v: { cobranzaId: string; nroCertificado: string }): string => `${v.cobranzaId}|ret|${v.nroCertificado}`

export type DecisionValor = { recibido: true } | { recibido: false; motivo: string }
export type Decisiones = Record<string, DecisionValor>

/** Qué falta decidir para poder cerrar: valores sin tilde y "no entregado" sin motivo. */
export function decisionesCompletas(valores: ValoresEnPapel, decisiones: Decisiones): { faltanDecidir: string[]; sinMotivo: string[]; ok: boolean } {
  const claves = [...valores.cheques.map(claveCheque), ...valores.retenciones.map(claveRetencion)]
  const faltanDecidir = claves.filter((k) => !decisiones[k])
  const sinMotivo = claves.filter((k) => { const d = decisiones[k]; return d && d.recibido === false && !d.motivo.trim() })
  return { faltanDecidir, sinMotivo, ok: faltanDecidir.length === 0 && sinMotivo.length === 0 }
}

/** Ausente (docs anteriores al 2026-09-09) cuenta como recibido. */
export const esRecibido = (v: { recibido?: boolean }): boolean => v.recibido !== false

/** Los valores con su decisión, listos para guardar en el cierre. */
export function aRendidos(valores: ValoresEnPapel, decisiones: Decisiones): { cheques: ChequeRendido[]; retenciones: RetencionRendida[] } {
  const marca = (k: string) => {
    const d = decisiones[k]
    if (!d || d.recibido) return { recibido: true as const }
    return { recibido: false as const, motivoNoEntregado: d.motivo.trim() }
  }
  return {
    cheques: valores.cheques.map((ch) => ({
      numero: ch.numero, bancoCodigo: '', bancoNombre: ch.bancoNombre, fechaEmision: '', fechaAcreditacion: ch.fechaAcreditacion, dias: 0, importe: ch.importe,
      cobranzaId: ch.cobranzaId, clienteNombre: ch.clienteNombre,
      ...(ch.numeroRecibo ? { numeroRecibo: ch.numeroRecibo } : {}), ...(ch.esEcheq ? { esEcheq: true } : {}),
      ...marca(claveCheque(ch)),
    })),
    retenciones: valores.retenciones.map((re) => ({
      tipo: re.tipo as RetencionRendida['tipo'], nroCertificado: re.nroCertificado, importe: re.importe,
      cobranzaId: re.cobranzaId, clienteNombre: re.clienteNombre,
      ...(re.numeroRecibo ? { numeroRecibo: re.numeroRecibo } : {}),
      ...marca(claveRetencion(re)),
    })),
  }
}

export interface ResumenValores {
  cheques: { cantidad: number; total: number; recibidos: number; faltantes: number; totalFaltante: number }
  retenciones: { cantidad: number; total: number; recibidos: number; faltantes: number; totalFaltante: number }
  faltantes: { cantidad: number; total: number }
}

/** Totales de valores rendidos y de los que no llegaron. */
export function resumenValores(cheques: ChequeRendido[], retenciones: RetencionRendida[]): ResumenValores {
  const parte = (xs: { importe: number; recibido?: boolean }[]) => {
    const falt = xs.filter((x) => !esRecibido(x))
    return { cantidad: xs.length, total: sumaImportes(xs), recibidos: xs.length - falt.length, faltantes: falt.length, totalFaltante: sumaImportes(falt) }
  }
  const c = parte(cheques), r = parte(retenciones)
  return { cheques: c, retenciones: r, faltantes: { cantidad: c.faltantes + r.faltantes, total: c.totalFaltante + r.totalFaltante } }
}
