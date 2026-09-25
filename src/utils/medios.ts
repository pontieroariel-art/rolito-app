import type { ChequeRecibido, Cobranza, RetencionRecibida } from '@/types'

// Qué plata (y qué papeles) trae una cobranza, en un solo lugar (2026-09-09;
// antes estaba duplicado dentro de utils/liquidacion.ts). La cobranza completa
// (desde 2026-09-05) trae `medios`; la simple vieja solo `formaPago` + importe.
// Cheques y retenciones no son efectivo: se rinden como valores en papel.

export const efectivoDe = (c: Cobranza): number =>
  c.medios ? c.medios.efectivo : c.formaPago === 'contado_efectivo' ? c.importe : 0

export const transferenciaDe = (c: Cobranza): number =>
  c.medios ? c.medios.transferencia : c.formaPago === 'contado_transferencia' ? c.importe : 0

export const chequesDe = (c: Cobranza): ChequeRecibido[] => c.medios?.cheques ?? []

export const retencionesDe = (c: Cobranza): RetencionRecibida[] => c.medios?.retenciones ?? []

export const sumaImportes = (xs: { importe: number }[]): number => xs.reduce((s, x) => s + x.importe, 0)

/** 'yyyy-MM-dd' → 'dd/mm'; sin fecha, un guión. */
const ddmm = (f?: string): string => (f && f.length >= 10 ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '—')

/**
 * Cómo se describe un cheque en un renglón (2026-09-24, pedido de Ariel: en
 * Mi turno hacía falta como mínimo número, banco, emisión y fecha de pago):
 * "e-cheq Nº 00778123 · Banco Galicia · emitido 24/09 · paga 08/11 (45 días)".
 */
export const textoCheque = (ch: Pick<ChequeRecibido, 'numero' | 'bancoNombre' | 'fechaEmision' | 'fechaAcreditacion' | 'dias' | 'esEcheq'>): string =>
  `${ch.esEcheq ? 'e-cheq' : 'cheque'} Nº ${ch.numero} · ${ch.bancoNombre} · emitido ${ddmm(ch.fechaEmision)} · paga ${ddmm(ch.fechaAcreditacion)}${ch.dias ? ` (${ch.dias} días)` : ''}`
