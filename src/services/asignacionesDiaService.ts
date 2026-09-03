import { doc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'

export interface AsignacionChofer {
  camionId:      string | null
  ayudanteEmail: string | null
}

export type AsignacionesDia = Record<string, AsignacionChofer>

export async function getAsignacionesDia(fecha: string): Promise<AsignacionesDia> {
  const snap = await getDoc(doc(db, 'asignacionesDia', fecha))
  return snap.exists() ? (snap.data()?.choferes ?? {}) : {}
}

// En vivo: si dos admins tienen el tablero de despacho abierto el mismo día,
// un cambio de camión/ayudante de uno se refleja en el otro sin recargar.
// También cierra de raíz la race condition de cambiar de fecha rápido que
// tenía el fetch puntual (una respuesta tardía de la fecha anterior ya no
// puede pisar el estado — onSnapshot se re-suscribe limpio en cada fecha).
export function subscribeAsignacionesDia(
  fecha:    string,
  callback: (asignaciones: AsignacionesDia) => void,
): () => void {
  return onSnapshot(
    doc(db, 'asignacionesDia', fecha),
    (snap) => callback(snap.exists() ? (snap.data()?.choferes ?? {}) : {}),
    (err) => { reportError(err, { subscription: 'asignacionesDia', fecha }); callback({}) },
  )
}

// Actualiza solo los campos indicados (camionId y/o ayudanteEmail) de UN
// chofer, leyendo el documento vigente del servidor dentro de una
// transacción. Evita que dos admins cambiando campos distintos del mismo
// chofer casi al mismo tiempo se pisen el cambio del otro con datos locales
// desactualizados (antes se mandaba siempre el objeto completo armado a
// partir del estado en memoria del componente).
export async function setAsignacionChofer(
  fecha: string,
  choferEmail: string,
  patch: Partial<AsignacionChofer>,
): Promise<void> {
  const ref = doc(db, 'asignacionesDia', fecha)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const choferes: AsignacionesDia = snap.exists() ? (snap.data()?.choferes ?? {}) : {}
    const current: AsignacionChofer = choferes[choferEmail] ?? { camionId: null, ayudanteEmail: null }
    tx.set(ref, { choferes: { [choferEmail]: { ...current, ...patch } } }, { merge: true })
  })
}
