import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { campoDeAviso, listaDeAviso, type TipoAviso } from '@/utils/avisosMail'

// ── Emails de los avisos internos (oficina) ───────────────────────────────────
// Sin `tipo` es la lista general (`emails`, respaldo de todo); con `tipo`, la
// lista propia de ese aviso (`avisos.<tipo>`). Ver utils/avisosMail.ts.

const notifRef = () => doc(db, 'configuracion', 'notificaciones')

export const getNotificationEmails = async (tipo?: TipoAviso): Promise<string[]> => {
  try {
    const snap = await getDoc(notifRef())
    if (snap.exists()) return listaDeAviso(snap.data(), tipo)
    await setDoc(notifRef(), { emails: [] })
    return []
  } catch (err) {
    reportError(err, { servicio: 'configService', op: 'getNotificationEmails' })
    return []
  }
}

export const addNotificationEmail = (email: string, tipo?: TipoAviso): Promise<void> =>
  updateDoc(notifRef(), { [campoDeAviso(tipo)]: arrayUnion(email) })

export const removeNotificationEmail = (email: string, tipo?: TipoAviso): Promise<void> =>
  updateDoc(notifRef(), { [campoDeAviso(tipo)]: arrayRemove(email) })
