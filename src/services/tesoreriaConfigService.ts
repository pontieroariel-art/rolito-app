import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'

// config/tesoreria { horasAvisoSobre } — a partir de cuántas horas un sobre
// que todavía nadie recibió se marca en tono aviso en la Recepción y en el
// tablero (rendición de fondos, 2026-09-14). Lo lee todo el staff (regla de
// config); si el doc no existe, vale el default.

export interface ConfigTesoreria { horasAvisoSobre: number }

export const HORAS_AVISO_SOBRE_DEFAULT = 20

export function normalizarConfigTesoreria(d: Partial<ConfigTesoreria> | null | undefined): ConfigTesoreria {
  const h = Number(d?.horasAvisoSobre)
  return { horasAvisoSobre: Number.isFinite(h) && h > 0 ? h : HORAS_AVISO_SOBRE_DEFAULT }
}

export const subscribeConfigTesoreria = (cb: (c: ConfigTesoreria) => void): (() => void) =>
  onSnapshot(
    doc(db, 'config', 'tesoreria'),
    (snap) => cb(normalizarConfigTesoreria(snap.data() as Partial<ConfigTesoreria> | undefined)),
    (err) => { reportError(err, { subscription: 'config/tesoreria' }); cb(normalizarConfigTesoreria(null)) },
  )

// ── Aviso de rendiciones pendientes (2026-09-23) ─────────────────────────────
// Lo escribe el servidor a las 6, 13 y 18 (`avisarRendicionesPendientes`); la
// app lo muestra en una franja en Mi turno, Sobres y Plata del día.

export interface AvisoRendiciones {
  generadoEn: { toDate(): Date } | null
  hoy: string
  viajes: { clave: string; nombre: string; fecha: string; codigo?: string; dias: number; tipo: 'viaje' | 'cobranzas' }[]
  sobres: { id: string; codigo: string; nombre: string; fecha: string; horas: number; tipo: 'sobre' | 'anticipo' }[]
  cajas:  { id: string; nombre: string; fecha: string }[]
  total: number
}

export const subscribeAvisoRendiciones = (cb: (a: AvisoRendiciones | null) => void): (() => void) =>
  onSnapshot(
    doc(db, 'config', 'avisoRendiciones'),
    (snap) => cb(snap.exists() ? (snap.data() as AvisoRendiciones) : null),
    (err) => { reportError(err, { subscription: 'config/avisoRendiciones' }); cb(null) },
  )
