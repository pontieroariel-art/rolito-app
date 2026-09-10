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

/** Reintento manual de la presentación a ARBA de un remito de carga (callable presentarCotRemito). */
export async function presentarCotRemito(remitoId: string): Promise<{ ok: boolean; cot?: string; error?: string }> {
  const fn = httpsCallable<{ remitoId: string }, { ok: boolean; cot?: string; error?: string }>(getFunctions(), 'presentarCotRemito')
  return (await fn({ remitoId })).data
}
