import type { CajaSesion, Liquidacion, Sobre } from '@/types'

// Rendición de fondos (2026-09-14), lado caja: qué movimientos pertenecen a
// UN turno y qué liquidaciones de choferes todavía no se rindieron. Puro,
// con tests; lo usan "Mi turno" y la ventanilla.

/**
 * Un movimiento (venta de ventanilla o cobranza de mostrador) es de este
 * turno si lleva su `cajaSesionId`. Los docs anteriores al turno de caja no
 * tienen el campo: van al PRIMER turno del día para que nada quede sin
 * rendir; a partir del segundo turno solo cuentan los propios.
 */
export function delTurno<T extends { cajaSesionId?: string }>(docs: T[], sesion: Pick<CajaSesion, 'id' | 'numero'>): T[] {
  return docs.filter((d) => (d.cajaSesionId ? d.cajaSesionId === sesion.id : sesion.numero === 1))
}

/**
 * Liquidaciones de choferes que este cajero cerró y cuyo efectivo todavía
 * tiene en la caja: sin entrega a tesorería (`entregaId === null`; las
 * anteriores a esa fase no traen el campo y no son candidatas) y que no
 * entraron en ningún sobre ya rendido (`sistema.origenIds.liquidacionesIds`).
 * Se miran varios días para atrás porque una liquidación cerrada a última
 * hora se rinde en el turno siguiente.
 */
export function liquidacionesPorRendir(liquidaciones: Liquidacion[], uid: string, sobresRendidos: Pick<Sobre, 'sistema'>[]): Liquidacion[] {
  const yaRendidas = new Set(sobresRendidos.flatMap((s) => s.sistema.origenIds.liquidacionesIds))
  return liquidaciones
    .filter((l) => l.cerradaPor?.uid === uid && l.entregaId === null && !yaRendidas.has(l.id))
    .sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0))
}

/** Hora corta de un Timestamp ("07:12"). */
export const horaCorta = (t: { toDate(): Date }): string => t.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
