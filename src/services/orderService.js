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

const ORDERS = 'orders'

export const createOrder = async ({ user, products, date, notes }) =>
  addDoc(collection(db, ORDERS), {
    clientId:      user.uid,
    clientName:    user.name,
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

export const updateOrderStatus = (orderId, status) =>
  updateDoc(doc(db, ORDERS, orderId), { status, updatedAt: serverTimestamp() })

export const assignDriver = (orderId, driverId) =>
  updateDoc(doc(db, ORDERS, orderId), { driverId, updatedAt: serverTimestamp() })

export const updateOrderAddress = (orderId, clientAddress) =>
  updateDoc(doc(db, ORDERS, orderId), { clientAddress, updatedAt: serverTimestamp() })

// Listener en tiempo real — pedidos del cliente autenticado
export const subscribeClientOrders = (clientId, callback) => {
  const q = query(
    collection(db, ORDERS),
    where('clientId', '==', clientId),
    orderBy('createdAt', 'desc')
  )
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  )
}

// Listener en tiempo real — todos los pedidos (admin)
export const subscribeAllOrders = (callback) => {
  const q = query(collection(db, ORDERS), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  )
}

// Listener en tiempo real — pedidos del chofer para hoy
// driverId almacena el email del chofer, no el uid
export const subscribeDriverOrders = (driverEmail, callback) => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)

  const q = query(
    collection(db, ORDERS),
    where('driverId', '==', driverEmail),
    where('date', '>=', Timestamp.fromDate(start)),
    where('date', '<=', Timestamp.fromDate(end))
  )
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  )
}
