import type { AnulacionEnCobranza, Cobranza } from '@/types'

// Estado de la anulación de un recibo de cobranza (2026-09-15), espejo de
// anulacionVenta.ts. `anulada` = el recibo no cuenta en rendición, liquidación,
// tesorería ni saldos. `pendiente`/`aprobada` = en curso: el recibo sigue
// valiendo, pero el que cobró no cierra su día hasta que alguien resuelva.

type ConAnulacion = { anulacion?: AnulacionEnCobranza | null }

export const cobranzaAnulada = (c: ConAnulacion): boolean => c.anulacion?.estado === 'anulada'
export const anulacionCobranzaEnCurso = (c: ConAnulacion): boolean => c.anulacion?.estado === 'pendiente' || c.anulacion?.estado === 'aprobada'
/** Las que valen: todas menos las anuladas. */
export const cobranzasVigentes = <T extends ConAnulacion>(cobranzas: T[]): T[] => cobranzas.filter((c) => !cobranzaAnulada(c))

/**
 * ¿Puede ESTE usuario pedir la anulación? Solo el que la registró, sobre un recibo
 * completo (con número), sin anulación en curso ni hecha. Que su día no esté cerrado
 * lo exigen las reglas (liquidación del cobrador / cierre de caja del cajero).
 */
export const reciboAnulable = (c: Pick<Cobranza, 'registradoPor' | 'numeroRecibo'> & ConAnulacion, uid: string): boolean =>
  c.registradoPor.uid === uid && !!c.numeroRecibo && !cobranzaAnulada(c) && !anulacionCobranzaEnCurso(c)

/** Texto corto del estado para chips y listas. */
export function textoAnulacionCobranza(a: AnulacionEnCobranza | null | undefined): { texto: string; tono: 'warn' | 'bad' | 'neutral' } | null {
  if (!a) return null
  switch (a.estado) {
    case 'pendiente': return { texto: 'Anulación pendiente de autorizar', tono: 'warn' }
    case 'aprobada':  return { texto: 'Anulación aprobada', tono: 'warn' }
    case 'anulada':   return {
      texto: a.tango?.estado === 'confirmado' ? 'Recibo anulado · anulado en Tango'
        : a.tango?.estado === 'no_aplica' ? 'Recibo anulado'
        : 'Recibo anulado · la oficina lo anula en Tango',
      tono: 'bad',
    }
    case 'rechazada': return { texto: 'Anulación rechazada: el recibo sigue vigente', tono: 'neutral' }
    case 'error':     return { texto: 'No se pudo anular: avisá a administración', tono: 'bad' }
  }
}
