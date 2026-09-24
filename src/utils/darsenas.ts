import { DARSENAS_POR_PLANTA, type PlantaId } from '@/types'

// Quién puede usar cada dársena del muelle (2026-09-24, pedido de Ariel para
// los chicos del muelle): la 1 es SOLO de camiones; de la 2 a la 5 entran
// camiones o clientes de ventanilla, la que esté libre. Antes la 4 y la 5 eran
// exclusivas de ventanilla y las demás de camiones, y en alta temporada
// quedaban bocas vacías de un lado con cola del otro. Lógica pura; la tablet,
// la tele y el selector de la tarjeta de carga leen de acá. El chofer que
// vuelve sigue eligiendo entre TODAS las libres (`useMuelleEstado`).

/** Dársenas donde NO se llama a un cliente de ventanilla: quedan para camiones. */
export const DARSENAS_SOLO_CAMION: Record<PlantaId, number[]> = {
  torcuato: [1],
  merlo:    [1],
}

export const todasLasDarsenas = (plantaId: PlantaId): number[] =>
  Array.from({ length: DARSENAS_POR_PLANTA[plantaId] }, (_, i) => i + 1)

/** Un camión (carga o vuelta) puede ir a cualquier boca. */
export const darsenasParaCamion = (plantaId: PlantaId): number[] => todasLasDarsenas(plantaId)

/** Un turno de ventanilla se llama a cualquier boca menos las reservadas a camiones. */
export const darsenasParaVentanilla = (plantaId: PlantaId): number[] =>
  todasLasDarsenas(plantaId).filter((n) => !DARSENAS_SOLO_CAMION[plantaId].includes(n))

export type OcupanteDarsena = 'carga' | 'regreso' | 'ventanilla'

interface FuentesOcupacion {
  /** Borradores pendientes con boca asignada (camión cargando). */
  cargas:     Array<{ id: string; darsena?: number }>
  /** Remitos con `regreso.darsena` y todavía sin contar (camión que volvió). */
  regresos:   Array<{ id: string; regreso?: { darsena?: number } }>
  /** Ventas de ventanilla con turno llamado a una boca. */
  ventanillas: Array<{ id: string; estado?: string; turnoEstado?: string; darsena?: number }>
}

/**
 * Qué boca está ocupada y por qué, con los datos que la tablet ya tiene en
 * pantalla (misma cuenta que publica el servidor en `muelleEstado`). Sirve
 * para no llamar un turno a una boca con un camión adentro ni mandar un
 * camión a una boca con un cliente cargando.
 */
export function ocupacionDarsenas(f: FuentesOcupacion): Map<number, { tipo: OcupanteDarsena; id: string }> {
  const m = new Map<number, { tipo: OcupanteDarsena; id: string }>()
  for (const r of f.regresos) if (r.regreso?.darsena) m.set(r.regreso.darsena, { tipo: 'regreso', id: r.id })
  for (const c of f.cargas) if (c.darsena && !m.has(c.darsena)) m.set(c.darsena, { tipo: 'carga', id: c.id })
  for (const v of f.ventanillas) {
    if (v.darsena && v.turnoEstado === 'llamado' && v.estado !== 'entregada' && v.estado !== 'anulada' && !m.has(v.darsena)) {
      m.set(v.darsena, { tipo: 'ventanilla', id: v.id })
    }
  }
  return m
}

/** Una boca está libre para `quien` si nadie más la ocupa (el propio doc no cuenta: es reasignación). */
export const darsenaLibrePara = (ocupacion: Map<number, { tipo: OcupanteDarsena; id: string }>, n: number, propioId?: string): boolean => {
  const o = ocupacion.get(n)
  return !o || o.id === propioId
}
