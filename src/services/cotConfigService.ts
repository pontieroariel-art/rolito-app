import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from './firebase'
import { reportError } from './observability'
import { normalizarCotConfig } from '@/utils/cot'
import type { CotConfig } from '@/types'

// config/cot — configuración del COT de ARBA (2026-09-10): interruptor,
// ambiente, umbrales, domicilio y recorrido por planta, peso y código de ARBA
// por producto, talonario del remito R que respalda la carga. La edita el
// super_admin desde Ajustes generales; la lee todo el staff (regla de config).
// La clave CIT NO va acá: es el secret ARBA_CIT de las functions.

const REF = () => doc(db, 'config', 'cot')

export const subscribeCotConfig = (cb: (cfg: CotConfig) => void): (() => void) =>
  onSnapshot(
    REF(),
    (snap) => cb(normalizarCotConfig((snap.data() ?? null) as Partial<CotConfig> | null)),
    (err) => { reportError(err, { subscription: 'config/cot' }); cb(normalizarCotConfig(null)) },
  )

export const guardarCotConfig = (cfg: CotConfig): Promise<void> =>
  setDoc(REF(), normalizarCotConfig(cfg), { merge: true })

// Contador del remito R de carga (config/remitoCargaCounter = { next }): la app
// numera el talonario 00025 al emitir; el super_admin lo inicializa desde
// Ajustes con el número siguiente al último remito manual.
const COUNTER_REF = () => doc(db, 'config', 'remitoCargaCounter')

export const subscribeContadorRemitoCarga = (cb: (next: number | null) => void): (() => void) =>
  onSnapshot(COUNTER_REF(), (snap) => cb(snap.exists() ? Number(snap.data().next) : null), (err) => { reportError(err, { subscription: 'config/remitoCargaCounter' }); cb(null) })

export const inicializarContadorRemitoCarga = (next: number): Promise<void> => setDoc(COUNTER_REF(), { next })

/** Reintento manual de la presentación a ARBA de un remito de carga (callable presentarCotRemito). */
export async function presentarCotRemito(remitoId: string): Promise<{ ok: boolean; cot?: string; error?: string }> {
  const fn = httpsCallable<{ remitoId: string }, { ok: boolean; cot?: string; error?: string }>(getFunctions(), 'presentarCotRemito')
  return (await fn({ remitoId })).data
}
