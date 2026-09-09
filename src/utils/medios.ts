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
