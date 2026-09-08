import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { normalizarAlertasMora, type AlertasMoraConfig } from '@/utils/mora'

// config/cobranzas { alertasMora: { diasAmarillo, diasRojo, importeRojo } } —
// umbrales de las alertas de mora del supervisor. Los edita super_admin desde
// Ajustes generales; los lee todo el staff (regla de config).

const REF = () => doc(db, 'config', 'cobranzas')

export const subscribeAlertasMora = (cb: (cfg: AlertasMoraConfig) => void): (() => void) =>
  onSnapshot(
    REF(),
    (snap) => cb(normalizarAlertasMora((snap.data()?.alertasMora ?? null) as Partial<AlertasMoraConfig> | null)),
    (err) => { reportError(err, { subscription: 'config/cobranzas' }); cb(normalizarAlertasMora(null)) },
  )

export const guardarAlertasMora = (cfg: AlertasMoraConfig): Promise<void> =>
  setDoc(REF(), { alertasMora: normalizarAlertasMora(cfg) }, { merge: true })
