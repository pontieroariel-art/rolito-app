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

// Contador del remito R de carga (config/remitoCargaCounter = { next, ultimo }):
// la app numera el talonario 00025 al emitir; el super_admin lo inicializa
// desde Ajustes con el primer número que autoriza el CAI y el último (la
// constancia de CAI autoriza un rango, p. ej. 251 a 1750; fuera de ese rango
// el remito no vale y la app no numera).
const COUNTER_REF = () => doc(db, 'config', 'remitoCargaCounter')

export interface ContadorRemitoCarga { next: number; ultimo: number | null }

export const subscribeContadorRemitoCarga = (cb: (c: ContadorRemitoCarga | null) => void): (() => void) =>
  onSnapshot(
    COUNTER_REF(),
    (snap) => cb(snap.exists() ? { next: Number(snap.data().next), ultimo: snap.data().ultimo != null ? Number(snap.data().ultimo) : null } : null),
    (err) => { reportError(err, { subscription: 'config/remitoCargaCounter' }); cb(null) },
  )

export const inicializarContadorRemitoCarga = (next: number, ultimo: number | null): Promise<void> =>
  setDoc(COUNTER_REF(), { next, ultimo })

/** Reintento manual de la presentación a ARBA de un remito de carga (callable presentarCotRemito). */
export async function presentarCotRemito(remitoId: string): Promise<{ ok: boolean; cot?: string; error?: string }> {
  const fn = httpsCallable<{ remitoId: string }, { ok: boolean; cot?: string; error?: string }>(getFunctions(), 'presentarCotRemito')
  return (await fn({ remitoId })).data
}
