import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
  query,
  where,
} from 'firebase/firestore'
import { db } from './firebase'
import { PedidoRecurrente } from '../types'

const COL    = 'pedidos-recurrentes'
const ORDERS = 'orders'

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

export const getAllRecurrentes = async (): Promise<PedidoRecurrente[]> => {
  const snap = await getDocs(query(collection(db, COL), where('activo', '==', true)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PedidoRecurrente))
}

export const generateRecurrentesForToday = async (): Promise<number> => {
  const today    = new Date()
  const todayDay = today.getDay()
  const todayStr = today.toDateString()

  const templates = await getAllRecurrentes()
  let generated   = 0

  for (const t of templates) {
    if (!t.diasSemana.includes(todayDay)) continue

    // Anti-duplicado: si ultimaGeneracion es hoy, saltar
    const ultima = t.ultimaGeneracion?.toDate?.()
    if (ultima && ultima.toDateString() === todayStr) continue

    // Crear el pedido como pendiente
    await addDoc(collection(db, ORDERS), {
      clientId:         t.clientId,
      clientEmail:      t.clientEmail,
      clientName:       t.clientName,
      clientAddress:    t.clientAddress,
      clientPhone:      t.clientPhone,
      products:         t.products,
      status:           'pendiente',
      date:             Timestamp.fromDate(today),
      driverId:         null,
      notes:            t.notas ?? '',
      origenRecurrente: true,
      createdAt:        serverTimestamp(),
      updatedAt:        serverTimestamp(),
    })

    // Marcar generado hoy
    await updateDoc(doc(db, COL, t.clientId), { ultimaGeneracion: serverTimestamp() })
    generated++
  }

  return generated
}
