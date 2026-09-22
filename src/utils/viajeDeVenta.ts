// A qué viaje pertenece una venta o una cobranza de la calle (2026-09-18).
//
// La plata se rinde POR VIAJE, y un chofer puede hacer dos en un día. Hacen falta
// dos cosas distintas, que conviene no mezclar:
//
//   1. A qué viaje pertenece una venta  → el viaje abierto del chofer al venderla
//   2. Cuándo se cierra ese conjunto    → la descarga de ESE viaje (por remito)
//
// Lo primero se resuelve acá. Desde el 2026-09-18 la app lo escribe en la venta
// (`VentaCamion.remitoId`), tomándolo del mismo remito del que ya salía el camión:
// el chofer no elige nada. Lo que sigue es para lo que no lo tiene — las ventas
// anteriores, y las del acompañante que sale sin remito propio.
//
// Por qué no se deduce por horarios: probamos cortar por la hora del conteo y se
// rompía en dos casos reales. La descarga se cuenta muchas veces al día siguiente
// (en el backfill del 17/09, dos de seis descargas eran de un viaje anterior), y
// el chofer que vuelve en otro camión deja el suyo varado días. En los dos casos
// las ventas de los viajes siguientes caían dentro del viaje viejo.

import { claveDia } from './diaReparto'
import type { RemitoCarga } from '../types'

/** Lo mínimo que hace falta de una venta o una cobranza para ubicarla en un viaje. */
export interface Ubicable {
  remitoId?: string
  camionId?: string
  choferId?: string
  /**
   * Quién lo registró. Un recibo del supervisor no trae remitoId, camionId ni
   * choferId (cobra desde la ficha del cliente, sin camión): su identidad es
   * esta. Sin esto, el supervisor que sale con un camión (Vañek, 22/09) pasaba
   * a liquidar por viaje y sus recibos del día desaparecían de la liquidación.
   */
  registradoPor?: { uid?: string } | null
  fecha:     { toDate(): Date }
}

/** Lo mínimo que hace falta de un remito. `choferId` es la identidad del depósito. */
export type ViajeCandidato = Pick<RemitoCarga, 'id' | 'camionId' | 'choferId' | 'fecha'>

/**
 * El viaje al que pertenece una venta.
 *
 * Primero lo que dice la venta. Si no lo dice (venta anterior al 18/09, o
 * acompañante sin remito), se busca el viaje de ese camión en el mismo día; si
 * hubo más de uno, el último que salió antes de la venta, que es el que el chofer
 * estaba haciendo. Sin camión, el viaje del chofer ese día.
 *
 * Devuelve `null` cuando no hay forma de ubicarla: esas ventas se rinden por día,
 * como antes.
 */
export function viajeDeVenta(venta: Ubicable, viajes: ViajeCandidato[]): string | null {
  if (venta.remitoId) return venta.remitoId
  if (!viajes.length) return null

  const cuando = venta.fecha.toDate().getTime()
  const dia = claveDia(venta.fecha.toDate())

  const delDia = viajes.filter((r) => claveDia(r.fecha.toDate()) === dia)
  // Primero los viajes del MISMO chofer en ese camión: dos choferes pueden salir
  // con el mismo camión el mismo día (21/09: Gerez a las 5 y González a las 7 en
  // AF985DC), y las ventas de uno no pueden caer en el viaje del otro. Si el
  // chofer no tiene viaje propio en ese camión (acompañante que sale sin remito),
  // recién ahí vale el viaje del camión; y sin camión, el del chofer.
  const persona   = venta.choferId ?? venta.registradoPor?.uid
  const delCamion = venta.camionId ? delDia.filter((r) => r.camionId === venta.camionId) : []
  const propios   = persona ? delCamion.filter((r) => r.choferId === persona) : []
  const mismos = propios.length
    ? propios
    : delCamion.length
      ? delCamion
      : persona
        ? delDia.filter((r) => r.choferId === persona)
        : []
  if (!mismos.length) return null

  // El último que ya había salido cuando se hizo la venta. Si la venta es
  // anterior a todos (reloj corrido, venta cargada antes de salir), el primero.
  const anteriores = mismos
    .filter((r) => r.fecha.toDate().getTime() <= cuando)
    .sort((a, b) => b.fecha.toDate().getTime() - a.fecha.toDate().getTime())
  if (anteriores.length) return anteriores[0].id

  return [...mismos].sort((a, b) => a.fecha.toDate().getTime() - b.fecha.toDate().getTime())[0].id
}

/**
 * Reparte una lista de ventas o cobranzas entre los viajes. Lo que no se pudo
 * ubicar queda en `sinViaje` y se rinde por día.
 */
export function repartirPorViaje<T extends Ubicable>(
  movimientos: T[],
  viajes: ViajeCandidato[],
): { porViaje: Map<string, T[]>; sinViaje: T[] } {
  const porViaje = new Map<string, T[]>()
  const sinViaje: T[] = []
  for (const m of movimientos) {
    const id = viajeDeVenta(m, viajes)
    if (!id) { sinViaje.push(m); continue }
    const lista = porViaje.get(id)
    if (lista) lista.push(m)
    else porViaje.set(id, [m])
  }
  return { porViaje, sinViaje }
}

/**
 * Las ventas de UN viaje. Es lo que caja liquida y lo que el cierre de mercadería
 * descuenta de la carga.
 */
export const ventasDelViaje = <T extends Ubicable>(movimientos: T[], viajes: ViajeCandidato[], remitoId: string): T[] =>
  movimientos.filter((m) => viajeDeVenta(m, viajes) === remitoId)
