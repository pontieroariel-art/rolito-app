import type { ConteoBilletes, DesgloseBilletes, EmpresaTango } from '@/types'

// Conteo de efectivo por denominación (rendición por sobres, etapa 1,
// 2026-09-16, decisión de Ariel): en todos los conteos —liquidación del
// repartidor o supervisor en ventanilla, cierre de turno, recepción en
// tesorería— la plata se cuenta billete por billete, sin atajo de "total
// directo". Cinco filas fijas más una de cambio chico como importe; una
// empresa que no entregó efectivo se marca a propósito ("sin efectivo"), así
// nunca queda un cero por olvido. Todo puro: la pantalla es
// components/common/TablaConteoBilletes.tsx.

export const DENOMINACIONES = [20000, 10000, 2000, 1000, 500] as const
export type Denominacion = (typeof DENOMINACIONES)[number]
export type ClaveDenominacion = `${Denominacion}`

export const EMPRESAS_CONTEO: EmpresaTango[] = ['redonhielo', 'rolito']

export const desgloseVacio = (): DesgloseBilletes => ({
  billetes: { '20000': 0, '10000': 0, '2000': 0, '1000': 0, '500': 0 },
  cambioChico: 0,
  sinEfectivo: false,
  total: 0,
})

export const conteoVacio = (): ConteoBilletes => ({ redonhielo: desgloseVacio(), rolito: desgloseVacio() })

/** Total en pesos: Σ denominación × cantidad + cambio chico. Con "sin efectivo", 0. */
export function totalDesglose(d: Pick<DesgloseBilletes, 'billetes' | 'cambioChico' | 'sinEfectivo'>): number {
  if (d.sinEfectivo) return 0
  return DENOMINACIONES.reduce((s, den) => s + den * (d.billetes[`${den}`] ?? 0), 0) + (d.cambioChico || 0)
}

/** Devuelve el desglose con una fila cambiada y el total recalculado. */
export function conCantidad(d: DesgloseBilletes, den: Denominacion, cantidad: number): DesgloseBilletes {
  const n = Number.isFinite(cantidad) ? Math.max(0, Math.floor(cantidad)) : 0
  const billetes = { ...d.billetes, [`${den}`]: n } as DesgloseBilletes['billetes']
  const nuevo = { ...d, billetes, sinEfectivo: false }
  return { ...nuevo, total: totalDesglose(nuevo) }
}

export function conCambioChico(d: DesgloseBilletes, importe: number): DesgloseBilletes {
  const n = Number.isFinite(importe) ? Math.max(0, Math.round(importe)) : 0
  const nuevo = { ...d, cambioChico: n, sinEfectivo: false }
  return { ...nuevo, total: totalDesglose(nuevo) }
}

/** Marcar "no recibí efectivo de esta empresa": vacía las filas y deja el total en 0. */
export function sinEfectivo(marcado: boolean): DesgloseBilletes {
  return { ...desgloseVacio(), sinEfectivo: marcado }
}

/** ¿Se contó? Alguna fila cargada, o la marca explícita de que no hubo efectivo. */
export const desgloseContado = (d: DesgloseBilletes): boolean =>
  d.sinEfectivo || DENOMINACIONES.some((den) => (d.billetes[`${den}`] ?? 0) > 0) || (d.cambioChico || 0) > 0

/** Un desglose bien formado: cantidades enteras no negativas y el total que corresponde. */
export function desgloseValido(d: DesgloseBilletes): boolean {
  if (!d || typeof d !== 'object' || !d.billetes) return false
  for (const den of DENOMINACIONES) {
    const n = d.billetes[`${den}`]
    if (!Number.isInteger(n) || n < 0) return false
  }
  if (!Number.isFinite(d.cambioChico) || d.cambioChico < 0) return false
  return d.total === totalDesglose(d)
}

export const conteoCompleto = (c: ConteoBilletes): boolean => EMPRESAS_CONTEO.every((e) => desgloseContado(c[e]))
export const conteoValido   = (c: ConteoBilletes): boolean => EMPRESAS_CONTEO.every((e) => desgloseValido(c[e]))
export const totalConteo    = (c: ConteoBilletes): number  => EMPRESAS_CONTEO.reduce((s, e) => s + c[e].total, 0)

export interface DiferenciaFila { fila: ClaveDenominacion | 'cambioChico'; a: number; b: number }

/** Filas donde dos conteos no coinciden (cantidades por billete; importe en cambio chico). */
export function compararDesgloses(a: DesgloseBilletes, b: DesgloseBilletes): DiferenciaFila[] {
  const out: DiferenciaFila[] = []
  for (const den of DENOMINACIONES) {
    const x = a.billetes[`${den}`] ?? 0, y = b.billetes[`${den}`] ?? 0
    if (x !== y) out.push({ fila: `${den}`, a: x, b: y })
  }
  if ((a.cambioChico || 0) !== (b.cambioChico || 0)) out.push({ fila: 'cambioChico', a: a.cambioChico || 0, b: b.cambioChico || 0 })
  return out
}

/** "$ 20.000" para las filas de la tabla y el PDF. */
export const etiquetaDenominacion = (den: Denominacion): string => `$ ${den.toLocaleString('es-AR')}`
