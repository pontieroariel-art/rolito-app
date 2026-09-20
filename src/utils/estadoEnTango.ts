/**
 * ¿Qué dice Tango HOY de un comprobante que la app dio por anulado? (2026-09-20)
 *
 * Los bloques "anulados en la app que hay que anular en Tango" listaban el
 * pendiente sin decir en qué estado está del otro lado, así que la oficina no
 * tenía cómo saber si una fila seguía ahí porque nadie la agarró, porque el
 * intento no prosperó, o porque falta que el lector la vea.
 *
 * El 20/09, con diez filas pendientes de hasta ocho días, Tango no tenía
 * ninguna anulada salvo una: tres remitos estaban FACTURADOS (por eso el
 * intento no podía prosperar: primero hay que anular la factura) y el recibo
 * de FERRANTE estaba anulado desde el 16/09 pero registrado en Tango con el
 * código de cliente `000000`, así que la ficha del cliente no lo mostraba
 * nunca. De ahí que la lectura se haga sobre el COMPROBANTE
 * (`tangoComprobanteDetalle/{empresa}_{tipo}_{numero}`) y no sobre el índice
 * del cliente: el número es el mismo mire quien mire.
 *
 * Estados de Tango:
 *  · remitos (STA14.ESTADO_MOV): 'A' anulado · 'F' facturado · 'P' pendiente
 *  · recibos (GVA12.ESTADO):     'ANU' anulado · 'IMP' imputado · 'CTA' a cuenta
 */

export type Situacion =
  /** Tango ya lo tiene anulado: la app lo suelta en la próxima pasada. */
  | 'anulado'
  /** Remito ya facturado: no se puede anular sin anular antes la factura. */
  | 'facturado'
  /** Vivo en Tango: se puede anular. */
  | 'vigente'
  /** Todavía no sabemos: el lector no trajo ese comprobante (o falta el número). */
  | 'sin_dato'

export interface LecturaTango {
  situacion: Situacion
  /** El código crudo que devolvió Tango, para mostrarlo cuando no es ninguno de los conocidos. */
  estado?: string
}

const limpio = (v: unknown) => String(v ?? '').trim().toUpperCase()

/** Remito de cta. cte.: 'A' anulado, 'F' facturado, el resto sigue vivo. */
export function lecturaRemito(estado: unknown): LecturaTango {
  const e = limpio(estado)
  if (!e) return { situacion: 'sin_dato' }
  if (e === 'A') return { situacion: 'anulado', estado: e }
  if (e === 'F') return { situacion: 'facturado', estado: e }
  return { situacion: 'vigente', estado: e }
}

/** Recibo de cobranza: solo 'ANU' está resuelto; imputado o a cuenta siguen vivos. */
export function lecturaRecibo(estado: unknown): LecturaTango {
  const e = limpio(estado)
  if (!e) return { situacion: 'sin_dato' }
  if (e === 'ANU') return { situacion: 'anulado', estado: e }
  return { situacion: 'vigente', estado: e }
}

/** Cómo se dice cada situación en la fila. El texto es una instrucción, no un reproche. */
export function textoTango(l: LecturaTango): { texto: string; ayuda?: string; tono: 'ok' | 'alerta' | 'neutro' } {
  switch (l.situacion) {
    case 'anulado':
      return { texto: 'Tango: anulado', ayuda: 'Listo — la fila se va sola en la próxima pasada', tono: 'ok' }
    case 'facturado':
      return { texto: 'Tango: FACTURADO', ayuda: 'Hay que anular antes la factura; el remito solo no se puede anular', tono: 'alerta' }
    case 'sin_dato':
      return { texto: 'Tango: sin datos', ayuda: 'El lector todavía no trajo ese comprobante — probá "Preguntar a Tango"', tono: 'neutro' }
    case 'vigente':
    default:
      return { texto: `Tango: vigente${l.estado ? ` (${l.estado})` : ''}`, ayuda: 'Sigue vivo en Tango: falta anularlo', tono: 'neutro' }
  }
}

/** Clave del comprobante en `tangoComprobanteDetalle`, igual que la escribe el lector. */
export const claveDetalle = (empresa: string, tipo: 'REM' | 'REC', numero: string) =>
  `${empresa}_${tipo}_${numero.trim().toUpperCase()}`
