import { doc, getDoc, setDoc } from 'firebase/firestore'
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

export async function setAsignacionChofer(
  fecha: string,
  choferEmail: string,
  asignacion: AsignacionChofer,
): Promise<void> {
  await setDoc(
    doc(db, 'asignacionesDia', fecha),
    { choferes: { [choferEmail]: asignacion } },
    { merge: true },
  )
}
