import { doc, getDoc, serverTimestamp, runTransaction } from 'firebase/firestore'
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
  const ref = doc(db, COL, clientId)
  // Transacción en vez de getDoc + set/update sueltos — evita la ventana de
  // carrera si dos guardados concurrentes tocan el mismo cliente (ej. dos
  // pestañas abiertas del mismo admin).
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref)
    if (existing.exists()) {
      tx.update(ref, { ...data })
    } else {
      tx.set(ref, { ...data, createdAt: serverTimestamp(), ultimaGeneracion: null })
    }
  })
}

// La generación diaria de pedidos a partir de estas plantillas corre server-side
// en la Cloud Function programada `generarPedidosRecurrentes`
// (functions/src/triggers/recurrentes.ts), no en el cliente.
