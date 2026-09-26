import type { FotoTurnoPallet, PersonaTurno } from '@/types'

// Turnos de producción por planta (2026-09-25). Editables por el encargado
// porque cambian con la temporada (dato de Ariel). Viven en
// config/produccionTurnos_{planta} = { turnos: TurnoProduccionDef[] }; sin el
// documento se usan los de siempre: 6 a 14, 14 a 22 y 22 a 6.
//
// Lógica pura: qué turno corre a una hora dada (incluido el que cruza la
// medianoche), cuándo empezó y cuándo termina.

export interface TurnoProduccionDef {
  /** Nombre corto que se muestra: "Mañana", "Tarde", "Noche". */
  nombre: string
  /** "HH:MM" en hora local. */
  desde:  string
  /** "HH:MM" en hora local. Si es menor o igual a `desde`, el turno cruza la medianoche. */
  hasta:  string
  /** Capitán del turno: uno por turno (pedido de Ariel). */
  capitan?:   PersonaTurno | null
  /** Operarios asignados al turno. */
  operarios?: PersonaTurno[]
}

export const TURNOS_POR_DEFECTO: TurnoProduccionDef[] = [
  { nombre: 'Mañana', desde: '06:00', hasta: '14:00' },
  { nombre: 'Tarde',  desde: '14:00', hasta: '22:00' },
  { nombre: 'Noche',  desde: '22:00', hasta: '06:00' },
]

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Minutos desde la medianoche de "HH:MM", o null si no es una hora válida. */
export function minutosDe(hhmm: string): number | null {
  const m = HHMM.exec(hhmm)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** Errores de una lista de turnos, para el editor. Vacío = se puede guardar. */
export function erroresTurnos(turnos: TurnoProduccionDef[]): string[] {
  const out: string[] = []
  if (turnos.length === 0) out.push('Tiene que haber al menos un turno.')
  turnos.forEach((t, i) => {
    const n = t.nombre.trim() || `Turno ${i + 1}`
    if (!t.nombre.trim()) out.push(`El turno ${i + 1} no tiene nombre.`)
    if (minutosDe(t.desde) === null) out.push(`${n}: la hora de inicio tiene que ser HH:MM.`)
    if (minutosDe(t.hasta) === null) out.push(`${n}: la hora de fin tiene que ser HH:MM.`)
  })
  return out
}

export interface TurnoEnCurso {
  turno:  TurnoProduccionDef
  inicio: Date
  fin:    Date
}

/**
 * El turno que corre en `ahora`, con su inicio y fin reales (fechas). Si hay
 * un hueco sin turno, devuelve null. Si dos turnos se pisan, gana el primero
 * de la lista.
 */
export function turnoEn(ahora: Date, turnos: TurnoProduccionDef[]): TurnoEnCurso | null {
  const min = ahora.getHours() * 60 + ahora.getMinutes()
  const dia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  const enMin = (base: Date, m: number) => new Date(base.getTime() + m * 60_000)
  for (const turno of turnos) {
    const d = minutosDe(turno.desde)
    const h = minutosDe(turno.hasta)
    if (d === null || h === null) continue
    if (d < h) {
      if (min >= d && min < h) return { turno, inicio: enMin(dia, d), fin: enMin(dia, h) }
    } else {
      // Cruza la medianoche (22:00 → 06:00), o dura 24 h si d == h.
      if (min >= d) return { turno, inicio: enMin(dia, d), fin: enMin(dia, h + 24 * 60) }
      if (min < h) {
        const ayer = new Date(dia.getTime() - 86_400_000)
        return { turno, inicio: enMin(ayer, d), fin: enMin(dia, h) }
      }
    }
  }
  return null
}

/** Nombre del turno en que se hizo algo (para agrupar pallets por turno). */
export function nombreTurnoDe(fecha: Date, turnos: TurnoProduccionDef[]): string {
  return turnoEn(fecha, turnos)?.turno.nombre ?? 'Fuera de turno'
}

const aDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * La foto del turno que se guarda en cada pallet (trazabilidad): nombre, día
 * en que empezó, capitán y dotación. Fuera de turno: el día calendario y sin
 * dotación.
 */
export function fotoTurno(fecha: Date, turnos: TurnoProduccionDef[]): FotoTurnoPallet {
  const t = turnoEn(fecha, turnos)
  if (!t) return { nombre: 'Fuera de turno', dia: aDia(fecha), capitan: null, dotacion: [] }
  return {
    nombre:   t.turno.nombre,
    dia:      aDia(t.inicio),
    capitan:  t.turno.capitan ?? null,
    dotacion: t.turno.operarios ?? [],
  }
}

/** El turno número `indice` de la lista para el día `dia` (YYYY-MM-DD): inicio y fin reales. */
export function rangoDeTurno(dia: string, turno: TurnoProduccionDef): { inicio: Date; fin: Date } | null {
  const d = minutosDe(turno.desde)
  const h = minutosDe(turno.hasta)
  if (d === null || h === null) return null
  const base = new Date(`${dia}T00:00:00`)
  const inicio = new Date(base.getTime() + d * 60_000)
  const fin = new Date(base.getTime() + (h > d ? h : h + 24 * 60) * 60_000)
  return { inicio, fin }
}
