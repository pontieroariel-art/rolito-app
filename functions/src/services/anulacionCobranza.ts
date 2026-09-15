/**
 * Anulación de un recibo de cobranza con autorización (2026-09-15) — lógica pura
 * del circuito, separada del trigger para poder testearla.
 *
 * El que cobró pide (`anulacionesCobranza/{cobranzaId}`), quien tiene
 * `autorizaAnulaciones` aprueba o rechaza, y el server marca la cobranza
 * (`cobranzas.anulacion`, que el cliente no puede escribir). Un recibo anulado
 * deja de contar en rendición, liquidación, tesorería y saldos. En Tango lo anula
 * la oficina (push a facturación) hasta que exista el writer SQL; el lector de
 * comprobantes lo confirma cuando ve el recibo con ESTADO 'ANU'.
 */

export interface AnulacionCobranzaDoc {
  estado?:         unknown
  origen?:         unknown            // 'supervisor' | 'cobrador' | 'caja'
  cobradorId?:     unknown
  cobradorNombre?: unknown
  clienteId?:      unknown
  clienteNombre?:  unknown
  numeroRecibo?:   unknown            // 'RS-000168'
  reciboTango?:    unknown            // 'X0110600000168'
  empresa?:        unknown
  codigoTango?:    unknown
  importe?:        unknown
  motivo?:         unknown
  nota?:           unknown
  fechaCobranza?:  unknown
  solicitadoPor?:  { uid?: unknown; nombre?: unknown }
  resueltaPor?:    { uid?: unknown; nombre?: unknown } | null
  notaResolucion?: unknown
}

export type TransicionRecibo = 'anular' | 'rechazar' | 'resolicitar' | null

/**
 * Qué hacer ante un cambio de la solicitud. Pura.
 *   pendiente|error → aprobada   anular el recibo
 *   pendiente       → rechazada  reflejar el rechazo y avisar al cobrador
 *   rechazada       → pendiente  volvió a pedir: avisar de nuevo
 */
export function transicionRecibo(antes: AnulacionCobranzaDoc | undefined, despues: AnulacionCobranzaDoc | undefined): TransicionRecibo {
  const a = antes?.estado
  const d = despues?.estado
  if (a === d) return null
  if (d === 'aprobada' && (a === 'pendiente' || a === 'error')) return 'anular'
  if (d === 'rechazada' && a === 'pendiente') return 'rechazar'
  if (d === 'pendiente' && a === 'rechazada') return 'resolicitar'
  return null
}

const pesos = (n: unknown) => `$${Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const txt = (v: unknown) => String(v ?? '').trim()

const MOTIVOS: Record<string, string> = {
  cheque_equivocado:    'datos del cheque equivocados',
  importe_equivocado:   'importe equivocado',
  cliente_equivocado:   'cliente equivocado',
  facturas_equivocadas: 'facturas imputadas equivocadas',
  medio_equivocado:     'medio de pago equivocado',
  otro:                 'otro motivo',
}
export const motivoLegible = (m: unknown): string => MOTIVOS[txt(m)] ?? txt(m)

/** Texto de la push a los autorizantes. */
export function avisoSolicitudRecibo(a: AnulacionCobranzaDoc): { titulo: string; cuerpo: string } {
  const quien = txt(a.origen) === 'supervisor' ? 'supervisor' : txt(a.origen) === 'cobrador' ? 'chofer' : 'mostrador'
  return {
    titulo: 'Anulación de recibo por autorizar',
    cuerpo: `Recibo ${txt(a.numeroRecibo) || 'sin número'} · ${txt(a.clienteNombre) || 'cliente'} · ${pesos(a.importe)} · ${motivoLegible(a.motivo)}${txt(a.nota) ? ` · ${txt(a.nota)}` : ''} (pidió ${txt(a.solicitadoPor?.nombre) || quien})`,
  }
}

/** A dónde vuelve el que cobró cuando le contestan, y a dónde va "Hacer el recibo correcto". */
export function urlDelCobrador(a: AnulacionCobranzaDoc): string {
  const o = txt(a.origen)
  return o === 'supervisor' ? '/supervisor' : o === 'cobrador' ? '/chofer/cobrar' : '/caja/cobranzas'
}
export function urlReemitirRecibo(a: AnulacionCobranzaDoc, cobranzaId: string): string {
  const o = txt(a.origen)
  const base = o === 'supervisor' ? '/supervisor/cobrar' : o === 'cobrador' ? '/chofer/cobrar' : '/caja/cobranzas'
  return `${base}?reemitir=${cobranzaId}`
}

/** Lo que queda escrito en `cobranzas.anulacion` al aprobarse. `ahora` lo pone el trigger (Timestamp). */
export function marcaAnulada<T>(a: AnulacionCobranzaDoc, cobranzaId: string, ahora: T): Record<string, unknown> {
  const enTango = txt(a.reciboTango) !== ''
  return {
    estado:        'anulada',
    solicitudId:   cobranzaId,
    motivo:        txt(a.motivo),
    nota:          txt(a.nota),
    anuladaPor:    { uid: txt(a.resueltaPor?.uid), nombre: txt(a.resueltaPor?.nombre) },
    anuladaEn:     ahora,
    fechaCobranza: txt(a.fechaCobranza),
    // Si el recibo nunca llegó a Tango no hay nada que anular allá.
    tango:         { estado: enTango ? 'pendiente_oficina' : 'no_aplica' },
  }
}

/** Texto de la push a facturación cuando hay que anular el recibo en Tango a mano. */
export function avisoAnularEnTango(a: AnulacionCobranzaDoc): { titulo: string; cuerpo: string } {
  return {
    titulo: 'Anular un recibo en Tango',
    cuerpo: `Recibo ${txt(a.reciboTango)} (${txt(a.numeroRecibo)}) de ${txt(a.clienteNombre)} por ${pesos(a.importe)}: anulado en la app con autorización de ${txt(a.resueltaPor?.nombre)}. Anularlo en Tango (cta. cte. y tesorería).`,
  }
}

/**
 * ¿El índice de comprobantes de Tango ya muestra el recibo anulado? El lector
 * publica cada GVA12 bajo `facturas[TIPO_NUMERO]` con su ESTADO; un recibo
 * anulado queda 'ANU'.
 */
export function reciboAnuladoEnIndice(indice: { facturas?: Record<string, { estado?: unknown }> } | undefined, reciboTango: string): boolean {
  const clave = `REC_${reciboTango.trim().toUpperCase()}`
  return String(indice?.facturas?.[clave]?.estado ?? '').trim().toUpperCase() === 'ANU'
}
