// Reserva local de números (remitos, facturas X y recibos) — 2026-09-26,
// auditoría del chofer, M2. Lógica pura compartida por numeracionInternaService
// y reciboSupervisorService.
//
// El problema: `asegurarReserva` leía la reserva, pedía un lote al servidor y
// al volver escribía `{ ...laReservaLeídaAntes, activo: lote }`. Si dos pedidos
// se cruzaban (la pantalla vuelve a montar, cambia la señal o el perfil), el
// último pisaba al primero y ese lote de números se perdía: huecos en un
// talonario con CAI. Ahora hay un solo pedido en vuelo por tipo y usuario, y el
// lote que vuelve se integra sobre la reserva RELEÍDA, sin pisar nada.

export interface RangoNumeros { from: number; to: number }
export interface ReservaNumeros<R extends RangoNumeros> {
  activo: (R & { usedUpTo: number }) | null
  siguiente: R | null
  reservaEnCurso: number | null
}

/**
 * Integra un lote recién reservado sobre la reserva actual. Si todavía quedan
 * números activos, el lote pasa a ser el siguiente; si no, es el activo. Nunca
 * descarta números: `sobrante` es el lote que ya no entra (hay activo con margen
 * Y siguiente), para dejarlo registrado.
 */
export function integrarLote<R extends RangoNumeros>(
  actual: ReservaNumeros<R>,
  lote: R,
): { reserva: ReservaNumeros<R>; sobrante: R | null } {
  const conMargen = !!actual.activo && actual.activo.usedUpTo < actual.activo.to
  if (!conMargen) {
    return { reserva: { ...actual, activo: { ...lote, usedUpTo: lote.from - 1 }, reservaEnCurso: null }, sobrante: null }
  }
  if (!actual.siguiente) return { reserva: { ...actual, siguiente: lote, reservaEnCurso: null }, sobrante: null }
  return { reserva: { ...actual, reservaEnCurso: null }, sobrante: lote }
}

/** Un solo pedido de lote en vuelo por clave (tipo + usuario) en esta pestaña. */
const enVuelo = new Map<string, Promise<boolean>>()
export function unSoloPedido(clave: string, fn: () => Promise<boolean>): Promise<boolean> {
  const previo = enVuelo.get(clave)
  if (previo) return previo
  const p = fn().finally(() => { enVuelo.delete(clave) })
  enVuelo.set(clave, p)
  return p
}
