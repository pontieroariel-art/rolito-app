import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { PlantaId } from '../types'
import { normalizarCopiasTicket } from '../utils/ventanillaTicket'

// config/ventanilla { copiasTicket: { torcuato: 3, merlo: 3 } } — cuántas
// copias del comprobante de turno imprime caja en cada planta (original
// cliente / duplicado muelle / triplicado seguridad, 2026-09-09). Lo edita
// super_admin desde Ajustes generales; lo lee todo el staff (regla de config).
// Sin doc o sin la planta, vale el default (3).

const REF = () => doc(db, 'config', 'ventanilla')

export type CopiasTicketPorPlanta = Record<PlantaId, number>

export function normalizarCopiasPorPlanta(raw: unknown): CopiasTicketPorPlanta {
  const r = (raw ?? {}) as Partial<Record<PlantaId, unknown>>
  return { torcuato: normalizarCopiasTicket(r.torcuato), merlo: normalizarCopiasTicket(r.merlo) }
}

export const subscribeCopiasTicket = (cb: (cfg: CopiasTicketPorPlanta) => void): (() => void) =>
  onSnapshot(
    REF(),
    (snap) => cb(normalizarCopiasPorPlanta(snap.data()?.copiasTicket)),
    (err) => { reportError(err, { subscription: 'config/ventanilla' }); cb(normalizarCopiasPorPlanta(null)) },
  )

export const guardarCopiasTicket = (cfg: CopiasTicketPorPlanta): Promise<void> =>
  setDoc(REF(), { copiasTicket: normalizarCopiasPorPlanta(cfg) }, { merge: true })
