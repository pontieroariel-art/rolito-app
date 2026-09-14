// Qué documento va a salir de esta operación.
//
// Sirve para que el chofer sepa ANTES de confirmar qué le va a quedar al
// cliente, y para no bloquearlo por datos fiscales cuando la app no va a
// facturar nada.
//
// ⚠️ Espejo de `functions/src/services/arca/circuito.ts`, que es el que manda:
// corre en el servidor y es el único que decide si se le pide un CAE a ARCA.
// Si allá cambia la regla, hay que reflejarla acá o la pantalla va a prometer
// un documento distinto del que sale.

import { CanalVenta, FormaPago } from '../types'

export type DocumentoDeVenta = 'factura_arca' | 'remito' | 'no_oficial'

const FORMAS_QUE_FACTURAN: FormaPago[] = ['contado_efectivo', 'contado_transferencia']

/**
 * `null` = todavía no se puede saber (falta elegir la forma de pago, o el
 * total no es un número). No es "no sale nada": es "no preguntes todavía".
 */
export function documentoDeVenta(
  canal: CanalVenta | null,
  formaPago: FormaPago | null,
  total: number,
): DocumentoDeVenta | null {
  if (canal === 'promo') return 'no_oficial'
  if (canal !== 'contado') return null

  if (!Number.isFinite(total)) return null
  // Sin importe no hay nada que facturar: una operación de solo cambios mueve
  // mercadería, no plata. (ARCA además rechaza un comprobante en cero.)
  if (total <= 0) return 'remito'

  if (formaPago === 'cuenta_corriente') return 'remito'
  if (formaPago && FORMAS_QUE_FACTURAN.includes(formaPago)) return 'factura_arca'
  return null
}

/**
 * Qué papel va a salir, en palabras del chofer (2026-09-13). La regla la
 * sabe la app: el chofer elige CÓMO PAGA el cliente y ve la consecuencia. Es
 * lo que los confundía al empezar (Redonhielo: contado factura / cuenta
 * corriente remito; Rolito: siempre factura), y no tiene por qué vivir en la
 * cabeza de nadie.
 *
 * 'papel' va grande; 'detalle' es la explicación corta. Sin documento (falta
 * la forma de pago) devuelve la invitación a elegirla, no un texto vacío.
 */
export function avisoDocumento(documento: DocumentoDeVenta | null): { papel: string; detalle: string } {
  switch (documento) {
    case 'factura_arca': return { papel: 'FACTURA',   detalle: 'electrónica de Redonhielo' }
    case 'remito':       return { papel: 'REMITO',    detalle: 'la factura la hace la oficina' }
    case 'no_oficial':   return { papel: 'FACTURA X', detalle: 'de Rolito' }
    default:             return { papel: '',          detalle: 'Elegí cómo paga y te digo qué sale' }
  }
}
