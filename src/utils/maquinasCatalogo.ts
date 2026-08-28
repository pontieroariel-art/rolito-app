import { TurnoProduccion } from '../types'

// Catálogo cerrado de la planilla "PARTE DE MÁQUINAS" (papel que llenaba el
// maquinista por turno) — confirmado por Ariel 2026-08-28: Torcuato y Merlo
// usan la misma planilla, un cambio acá es un deploy.

// Roliteras: las máquinas que producen el hielo. Cada ciclo registra SALE
// (empieza a tirar el hielo) y ENTRA (arranca el ciclo nuevo, ~4 min después).
export const ROLITERAS = [1, 2, 3] as const

export interface MaquinariaDef {
  id:       string
  label:    string
  cantidad: number   // numeración 1..cantidad (tildes de la planilla papel)
}

export const MAQUINARIAS: MaquinariaDef[] = [
  { id: 'bombas',               label: 'Bombas',                   cantidad: 3 },
  { id: 'osmosis',              label: 'Ósmosis',                  cantidad: 3 },
  { id: 'compresores_amoniaco', label: 'Compresores de amoníaco',  cantidad: 3 },
  { id: 'compresores_aire',     label: 'Compresores de aire',      cantidad: 2 },
  { id: 'torres_enfriamiento',  label: 'Torres de enfriamiento',   cantidad: 2 },
  { id: 'tanque_amoniaco',      label: 'Tanque de amoníaco',       cantidad: 4 },
  { id: 'escamadoras',          label: 'Escamadoras',              cantidad: 2 },
  { id: 'robots',               label: 'Robots',                   cantidad: 2 },
]

export const TURNOS: { id: TurnoProduccion; label: string }[] = [
  { id: 'manana', label: 'Mañana' },
  { id: 'tarde',  label: 'Tarde' },
  { id: 'noche',  label: 'Noche' },
]

export const TURNO_LABELS: Record<TurnoProduccion, string> = {
  manana: 'Mañana', tarde: 'Tarde', noche: 'Noche',
}

// Sugerencia inicial del selector de turno según la hora local — el
// maquinista siempre puede elegir otro (ej. carga el parte al final del turno).
export function sugerirTurno(hora: number): TurnoProduccion {
  if (hora >= 6 && hora < 14) return 'manana'
  if (hora >= 14 && hora < 22) return 'tarde'
  return 'noche'
}
