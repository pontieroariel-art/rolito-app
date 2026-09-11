import type { AnulacionEnVenta } from '@/types'

// Estado de la anulación con nota de crédito, igual para la venta de
// ventanilla y la del camión (2026-09-11). `anulada` = la NC ya tiene CAE: la
// venta no cuenta en plata ni en stock. `pendiente`/`aprobada` = en curso: la
// venta sigue valiendo, pero no se cierra la caja ni la liquidación hasta que
// alguien resuelva.

type ConAnulacion = { anulacion?: AnulacionEnVenta | null }

export const ventaAnulada = (v: ConAnulacion): boolean => v.anulacion?.estado === 'anulada'
export const anulacionEnCurso = (v: ConAnulacion): boolean => v.anulacion?.estado === 'pendiente' || v.anulacion?.estado === 'aprobada'
/** Las que valen: todas menos las anuladas. */
export const ventasVigentes = <T extends ConAnulacion>(ventas: T[]): T[] => ventas.filter((v) => !ventaAnulada(v))

/** ¿Se puede pedir la anulación? Factura ARCA emitida y ninguna anulación en curso ni hecha. */
export const facturaAnulable = (v: ConAnulacion & { factura?: { estado?: string; cae?: string | null } }): boolean =>
  v.factura?.estado === 'emitida' && !!v.factura.cae && !ventaAnulada(v) && !anulacionEnCurso(v)

/** Texto corto del estado para chips y listas. */
export function textoAnulacion(a: AnulacionEnVenta | null | undefined): { texto: string; tono: 'warn' | 'bad' | 'neutral' } | null {
  if (!a) return null
  const nc = a.notaCredito
  switch (a.estado) {
    case 'pendiente': return { texto: 'Anulación pendiente de autorizar', tono: 'warn' }
    case 'aprobada':  return { texto: 'Anulación aprobada · emitiendo la nota de crédito', tono: 'warn' }
    case 'anulada':   return { texto: `Anulada · NC ${nc ? `${String(nc.puntoVenta).padStart(5, '0')}-${String(nc.numero).padStart(8, '0')}` : ''}`.trim(), tono: 'bad' }
    case 'rechazada': return { texto: 'Anulación rechazada: la factura sigue vigente', tono: 'neutral' }
    case 'error':     return { texto: 'No se pudo emitir la nota de crédito: avisá a administración', tono: 'bad' }
  }
}
