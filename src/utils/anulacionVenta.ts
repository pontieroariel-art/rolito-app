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

/**
 * ¿Se puede pedir la anulación? Factura ARCA emitida, o promo con factura X
 * numerada (NC interna, 2026-09-11); y ninguna anulación en curso ni hecha.
 */
export const facturaAnulable = (v: ConAnulacion & { canal?: string; factura?: { estado?: string; cae?: string | null }; comprobanteInterno?: { tipo?: string; numero?: number } | null }): boolean =>
  ((v.factura?.estado === 'emitida' && !!v.factura.cae) || (v.canal === 'promo' && v.comprobanteInterno?.tipo === 'facturaX' && (v.comprobanteInterno.numero ?? 0) > 0))
  && !ventaAnulada(v) && !anulacionEnCurso(v)

/** Texto corto del estado para chips y listas. */
export function textoAnulacion(a: AnulacionEnVenta | null | undefined): { texto: string; tono: 'warn' | 'bad' | 'neutral' } | null {
  if (!a) return null
  const nc = a.notaCredito
  switch (a.estado) {
    case 'pendiente': return { texto: 'Anulación pendiente de autorizar', tono: 'warn' }
    case 'aprobada':  return { texto: 'Anulación aprobada · emitiendo la nota de crédito', tono: 'warn' }
    case 'anulada': {
      const n = nc ?? a.notaCreditoInterna
      return { texto: `Anulada · NC${a.notaCreditoInterna && !nc ? ' X' : ''} ${n ? `${String(n.puntoVenta).padStart(5, '0')}-${String(n.numero).padStart(8, '0')}` : ''}`.trim(), tono: 'bad' }
    }
    case 'rechazada': return { texto: 'Anulación rechazada: la factura sigue vigente', tono: 'neutral' }
    case 'error':     return { texto: 'No se pudo emitir la nota de crédito: avisá a administración', tono: 'bad' }
  }
}
