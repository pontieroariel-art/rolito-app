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
