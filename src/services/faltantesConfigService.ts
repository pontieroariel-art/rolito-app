import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { normalizarUmbralFaltantes, type UmbralFaltantes } from '@/utils/faltantes'

// config/liquidacion { faltantes: { habilitado, bolsas } } — desde cuántas
// bolsas faltantes en la descarga contada el desvío es grave y hay que
// resolverlo antes de cerrar la caja del repartidor. Lo edita super_admin desde
// Ajustes generales; lo lee todo el staff (regla de config) y también el
// trigger que marca la descarga.

const REF = () => doc(db, 'config', 'liquidacion')

export const subscribeUmbralFaltantes = (cb: (u: UmbralFaltantes) => void): (() => void) =>
  onSnapshot(
    REF(),
    (snap) => cb(normalizarUmbralFaltantes((snap.data()?.faltantes ?? null) as Partial<UmbralFaltantes> | null)),
    (err) => { reportError(err, { subscription: 'config/liquidacion' }); cb(normalizarUmbralFaltantes(null)) },
  )

export const guardarUmbralFaltantes = (u: UmbralFaltantes): Promise<void> =>
  setDoc(REF(), { faltantes: normalizarUmbralFaltantes(u) }, { merge: true })
