import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { PedidoRecurrente } from '../types'

const COL = 'pedidos-recurrentes'

export const getRecurrenteByClient = async (clientId: string): Promise<PedidoRecurrente | null> => {
  const snap = await getDoc(doc(db, COL, clientId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as PedidoRecurrente
}

export const saveRecurrente = async (
  clientId: string,
  data: Omit<PedidoRecurrente, 'id' | 'createdAt' | 'ultimaGeneracion'>,
): Promise<void> => {
  const ref      = doc(db, COL, clientId)
  const existing = await getDoc(ref)
  if (existing.exists()) {
    await updateDoc(ref, { ...data })
  } else {
    await setDoc(ref, { ...data, createdAt: serverTimestamp(), ultimaGeneracion: null })
  }
}

// La generación diaria de pedidos a partir de estas plantillas corre server-side
// en la Cloud Function programada `generarPedidosRecurrentes`
// (functions/src/triggers/recurrentes.ts), no en el cliente.
