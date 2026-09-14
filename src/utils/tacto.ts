// Feedback táctil para las pantallas de calle (2026-09-13).
//
// El objetivo es que la app se sienta nativa en el teléfono del chofer: que
// cada toque conteste al instante, con el dedo y con la vista.
//
// OJO con la vibración: `navigator.vibrate` NO existe en Safari de iPhone (ni
// en iOS en general, ni siquiera instalando la PWA). En Android funciona y no
// pide permiso. Así que la vibración es un PLUS, nunca la única señal: todo lo
// que vibra tiene además una respuesta visual, porque para media flota puede no
// existir. Y si el teléfono está en silencio o el navegador la bloquea, esto
// falla en silencio en vez de romper el toque.

/** Duraciones pensadas para que se sientan distintas sin molestar. */
export const TACTO = {
  /** Un toque cualquiera: sumar, restar, elegir una opción. */
  toque: 10,
  /** Cambió algo importante: la forma de pago, el comprobante que va a salir. */
  cambio: 18,
  /** Se completó el trabajo: la venta quedó registrada. */
  exito: [16, 45, 24] as number[],
  /** No se pudo: algo faltaba o falló. */
  error: [40, 60, 40] as number[],
} as const

/**
 * Vibra si el teléfono puede. Nunca tira error: un fallo de vibración jamás
 * puede interrumpir una venta en la calle.
 */
export function vibrar(patron: number | number[] = TACTO.toque): void {
  try {
    // Algunos navegadores exponen la función pero la ignoran sin gesto previo.
    navigator.vibrate?.(patron)
  } catch {
    /* el teléfono no vibra: seguimos, la respuesta visual alcanza */
  }
}

/** ¿Este teléfono puede vibrar? Para no prometer lo que no va a pasar. */
export const hayVibracion = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

/**
 * El usuario pidió menos movimiento (iOS y Android lo ofrecen en accesibilidad).
 * Las transiciones se acortan a cero en vez de ignorarlo: mareamos a nadie.
 */
export const menosMovimiento = (): boolean =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
