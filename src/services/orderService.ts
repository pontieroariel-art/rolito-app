import {
  collection,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { Order, OrderProduct, UserProfile } from '../types'

const ORDERS = 'orders'

interface CreateOrderParams {
  user: UserProfile
  products: OrderProduct[]
  date: string
  notes: string
}

export const createOrder = ({ user, products, date, notes }: CreateOrderParams) =>
  addDoc(collection(db, ORDERS), {
    clientId:      user.uid,
    clientName:    user.nombre,
    clientAddress: user.address,
    clientPhone:   user.phone ?? '',
    products,
    status:        'pendiente',
    date:          Timestamp.fromDate(new Date(date)),
    driverId:      null,
    notes:         notes || '',
    createdAt:     serverTimestamp(),
    updatedAt:     serverTimestamp(),
  })

export const updateOrderStatus = (orderId: string, status: string): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), { status, updatedAt: serverTimestamp() })

export const assignDriver = (orderId: string, driverId: string | null): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), { driverId, updatedAt: serverTimestamp() })

export const updateOrderAddress = (orderId: string, clientAddress: string): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), { clientAddress, updatedAt: serverTimestamp() })

export const subscribeClientOrders = (
  clientId: string,
  callback: (orders: Order[]) => void,
  onError?: (error: Error) => void,
) => {
  const q = query(
    collection(db, ORDERS),
    where('clientId', '==', clientId),
    orderBy('createdAt', 'desc'),
  )
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order))),
    onError,
  )
}

export const subscribeAllOrders = (
  callback: (orders: Order[]) => void,
  onError?: (error: Error) => void,
) => {
  const q = query(collection(db, ORDERS), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order))),
    onError,
  )
}

export const subscribeDriverOrders = (
  driverEmail: string,
  callback: (orders: Order[]) => void,
  onError?: (error: Error) => void,
) => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)

  const q = query(
    collection(db, ORDERS),
    where('driverId', '==', driverEmail),
    where('date', '>=', Timestamp.fromDate(start)),
    where('date', '<=', Timestamp.fromDate(end)),
  )
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order))),
    onError,
  )
}
