import { doc, getDoc, runTransaction } from 'firebase/firestore'
import { db } from './firebase'

export interface AsignacionChofer {
  camionId:      string | null
  ayudanteEmail: string | null
}

export type AsignacionesDia = Record<string, AsignacionChofer>

export async function getAsignacionesDia(fecha: string): Promise<AsignacionesDia> {
  const snap = await getDoc(doc(db, 'asignacionesDia', fecha))
  return snap.exists() ? (snap.data()?.choferes ?? {}) : {}
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
