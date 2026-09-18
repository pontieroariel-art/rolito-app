// "Faltan borradores para mañana" (2026-09-18).
//
// Desde que el remito lo emite muelle al entregar el camión, lo que caja tiene
// que dejar hecho la tarde anterior es el BORRADOR. Si falta, el camión de las 4
// de la mañana se queda parado esperando que alguien de caja se despierte.
//
// No hay ninguna tabla de "camiones que salen mañana": la mejor señal disponible
// es la de hoy. El camión que hoy salió a las 4:10 con Mira casi seguro sale
// mañana a las 4:10 con Mira. Así que la tira se arma con los camiones que
// SALIERON HOY y marca cuáles todavía no tienen borrador para mañana.
//
// Muestra lo que FALTA, no lo que está: la lista útil a las 17 es la de los
// camiones sin instrucción.

import type { BorradorCarga, RemitoCarga } from '../types'

/** Antes de esta hora, el camión sale de madrugada: nadie de caja va a estar para armarle la carga. */
export const HORA_MADRUGADA = 8

export interface CamionDelDia {
  camionId:     string
  camionLabel:  string
  choferId:     string
  choferNombre: string
  /** Hora a la que salió hoy (HH:MM), '' si todavía no marcó salida. */
  horaSalida:   string
  /** Salió antes de HORA_MADRUGADA: es el que frena si mañana falta el borrador. */
  madrugada:    boolean
  /** Ya tiene borrador armado para el día que se está planificando. */
  tieneBorrador: boolean
}

const hhmm = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/**
 * Los camiones que hoy tuvieron carga, uno por camión, con la hora de la PRIMERA
 * salida del día (la de madrugada es la que importa; un segundo viaje a las 14
 * no dice nada sobre la mañana siguiente).
 */
export function camionesQueSalieronHoy(
  remitos: RemitoCarga[],
  horaMadrugada = HORA_MADRUGADA,
): Omit<CamionDelDia, 'tieneBorrador'>[] {
  const porCamion = new Map<string, { remito: RemitoCarga; salida: Date | null }>()
  for (const r of remitos) {
    if (!r.camionId) continue
    const salida = r.salida?.hora ? r.salida.hora.toDate() : null
    const actual = porCamion.get(r.camionId)
    // Nos quedamos con la salida más temprana; si ninguna marcó salida, con el
    // primer remito que aparezca (el camión igual estuvo cargado hoy).
    if (!actual) { porCamion.set(r.camionId, { remito: r, salida }); continue }
    if (salida && (!actual.salida || salida.getTime() < actual.salida.getTime())) {
      porCamion.set(r.camionId, { remito: r, salida })
    }
  }

  return [...porCamion.values()]
    .map(({ remito, salida }) => ({
      camionId:     remito.camionId,
      camionLabel:  remito.camionLabel,
      choferId:     remito.choferId,
      choferNombre: remito.choferNombre,
      horaSalida:   salida ? hhmm(salida) : '',
      madrugada:    !!salida && salida.getHours() < horaMadrugada,
    }))
}

/**
 * Cruza los camiones de hoy contra los borradores ya armados para el día que se
 * planifica. Primero los de madrugada (y entre ellos, el que sale más temprano),
 * después el resto por hora de salida; los que nunca marcaron salida, al final.
 */
export function borradoresFaltantes(
  remitosDeHoy: RemitoCarga[],
  borradores: Pick<BorradorCarga, 'camionId'>[],
  horaMadrugada = HORA_MADRUGADA,
): { faltan: CamionDelDia[]; listos: CamionDelDia[] } {
  const conBorrador = new Set(borradores.map((b) => b.camionId))
  const filas: CamionDelDia[] = camionesQueSalieronHoy(remitosDeHoy, horaMadrugada)
    .map((c) => ({ ...c, tieneBorrador: conBorrador.has(c.camionId) }))
    .sort(ordenar)
  return {
    faltan: filas.filter((f) => !f.tieneBorrador),
    listos: filas.filter((f) => f.tieneBorrador),
  }
}

const ordenar = (a: CamionDelDia, b: CamionDelDia): number => {
  if (a.madrugada !== b.madrugada) return a.madrugada ? -1 : 1
  if (!a.horaSalida) return b.horaSalida ? 1 : 0
  if (!b.horaSalida) return -1
  return a.horaSalida.localeCompare(b.horaSalida)
}
