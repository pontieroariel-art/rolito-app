import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  limit,
} from 'firebase/firestore'
import { db } from './firebase'
import { Order, OrderProduct, UserProfile, getPrimaryAddress } from '../types'

const ORDERS = 'orders'

export interface Actor { uid: string; nombre: string }

function accion(actor: Actor, tipo: string, detalle?: string) {
  return {
    accion:        tipo,
    usuarioId:     actor.uid,
    usuarioNombre: actor.nombre,
    timestamp:     Timestamp.now(),
    detalle:       detalle ?? null,
  }
}

interface CreateOrderParams {
  user: UserProfile
  products: OrderProduct[]
  date: string
  notes: string
  address?: string  // override para clientes multi-sucursal
}

export const createOrder = ({ user, products, date, notes, address }: CreateOrderParams) => {
  const primaryAddr    = getPrimaryAddress(user)
  const clientAddress  = address               || primaryAddr?.address || user.address  || ''
  const clientName     = user.razonSocial      || user.nombre   || ''
  const clientPhone    = user.telefono         || user.phone    || ''
  return addDoc(collection(db, ORDERS), {
    clientId:    user.uid,
    clientEmail: user.email,
    clientName,
    clientAddress,
    clientPhone,
    products,
    status:    'pendiente',
    date:      Timestamp.fromDate(new Date(date + 'T12:00:00')),
    driverId:  null,
    notes:     notes || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export const createOrderManual = ({
  cliente, products, date, notes, address,
}: {
  cliente:  UserProfile
  products: OrderProduct[]
  date:     string
  notes:    string
  address:  string
}) =>
  addDoc(collection(db, ORDERS), {
    clientId:      cliente.uid,
    clientEmail:   cliente.email,
    clientName:    cliente.razonSocial || cliente.nombre || '',
    clientAddress: address,
    clientPhone:   cliente.telefono   || cliente.phone  || '',
    products,
    status:       'pendiente',
    date:         Timestamp.fromDate(new Date(date + 'T12:00:00')),
    driverId:     null,
    notes:        notes || '',
    origenManual: true,
    createdAt:    serverTimestamp(),
    updatedAt:    serverTimestamp(),
  })

interface CreateOrderExternoParams {
  clientName:    string
  clientAddress: string
  products:      OrderProduct[]
  date:          string
  notes?:        string
  numeroOC?:     string
  horaEntrega?:  string
  clientId?:     string
  clientEmail?:  string
  clientPhone?:  string
}

export const createOrderExterno = (params: CreateOrderExternoParams) =>
  addDoc(collection(db, ORDERS), {
    clientId:      params.clientId    ?? 'externo',
    clientEmail:   params.clientEmail ?? '',
    clientName:    params.clientName,
    clientAddress: params.clientAddress,
    clientPhone:   params.clientPhone ?? '',
    products:      params.products,
    status:        'pendiente',
    date:          Timestamp.fromDate(new Date(params.date + 'T12:00:00')),
    driverId:      null,
    notes:         params.notes ?? '',
    origenPdf:     true,
    numeroOC:      params.numeroOC ?? '',
    horaEntrega:   params.horaEntrega ?? '',
    createdAt:     serverTimestamp(),
    updatedAt:     serverTimestamp(),
  })

export const updateOrderStatus = (orderId: string, status: string): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), { status, updatedAt: serverTimestamp() })

export const cancelOrder = (orderId: string, motivo: string): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), {
    status:              'cancelado',
    motivoCancelacion:   motivo,
    updatedAt:           serverTimestamp(),
  })

export const markDelivered = (
  orderId: string,
  entregados: OrderProduct[],
  parcial: boolean,
  nota: string,
): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), {
    status:               'entregado',
    productosEntregados:  entregados,
    entregaParcial:       parcial,
    notaEntrega:          nota || '',
    updatedAt:            serverTimestamp(),
  })

export const assignDriver = (orderId: string, driverId: string | null): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), { driverId, updatedAt: serverTimestamp() })

export const updateOrderAddress = (orderId: string, clientAddress: string): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), { clientAddress, updatedAt: serverTimestamp() })

export const moveOrderDate = (orderId: string, dateStr: string): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), {
    date:      Timestamp.fromDate(new Date(dateStr + 'T12:00:00')),
    updatedAt: serverTimestamp(),
  })

export const rescheduleOrder = (
  orderId:  string,
  newDate:  string,
  motivo:   string,
  opts:     { fechaOriginal: Timestamp; choferOriginal?: string },
): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), {
    date:                 Timestamp.fromDate(new Date(newDate + 'T12:00:00')),
    reprogramado:         true,
    fechaOriginal:        opts.fechaOriginal,
    motivoReprogramacion: motivo,
    choferOriginal:       opts.choferOriginal ?? null,
    driverId:             null,
    status:               'pendiente',
    updatedAt:            serverTimestamp(),
  })

export const reassignOrder = (
  orderId:        string,
  newDriverId:    string,
  motivo:         string,
  choferOriginal: string,
): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), {
    driverId:           newDriverId,
    reasignado:         true,
    choferOriginal,
    motivoReasignacion: motivo,
    updatedAt:          serverTimestamp(),
  })

export const cancelOrderBy = (orderId: string, motivo: string, actor: Actor): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), {
    status:            'cancelado',
    motivoCancelacion: motivo,
    updatedAt:         serverTimestamp(),
    historialAcciones: arrayUnion(accion(actor, 'cancelado', motivo)),
  })

export interface EditOrderParams {
  products:    OrderProduct[]
  date:        string
  horaEntrega: string
  notes:       string
}

export const editOrderBy = (orderId: string, params: EditOrderParams, actor: Actor): Promise<void> => {
  const detalle = `Productos/fecha/hora actualizados`
  return updateDoc(doc(db, ORDERS, orderId), {
    products:    params.products,
    date:        Timestamp.fromDate(new Date(params.date + 'T12:00:00')),
    horaEntrega: params.horaEntrega || null,
    notes:       params.notes,
    updatedAt:   serverTimestamp(),
    historialAcciones: arrayUnion(accion(actor, 'modificado', detalle)),
  })
}

export const getOrdersInRange = async (start: Date, end: Date): Promise<Order[]> => {
  const q = query(
    collection(db, ORDERS),
    where('date', '>=', Timestamp.fromDate(start)),
    where('date', '<=', Timestamp.fromDate(end)),
    orderBy('date', 'asc'),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order))
}

export const subscribeClientOrders = (
  clientId: string,
  callback: (orders: Order[]) => void,
  onError?: (error: Error) => void,
) => {
  // orderBy('createdAt') junto con where('clientId') requeriría un índice
  // compuesto; se ordena en cliente para evitar la dependencia del índice.
  const q = query(
    collection(db, ORDERS),
    where('clientId', '==', clientId),
    limit(200),
  )
  return onSnapshot(
    q,
    (snap) => {
      const orders = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Order))
        .sort((a, b) => {
          const at = a.createdAt?.seconds ?? 0
          const bt = b.createdAt?.seconds ?? 0
          return bt - at
        })
      callback(orders)
    },
    (err) => { console.error('subscribeClientOrders error:', err); onError?.(err) },
  )
}

export const subscribeAllOrders = (
  callback: (orders: Order[]) => void,
  onError?: (error: Error) => void,
) => {
  const thirtyDaysAgo = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  const q = query(
    collection(db, ORDERS),
    where('date', '>=', thirtyDaysAgo),
    orderBy('date', 'desc'),
    limit(500),
  )
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order))),
    onError,
  )
}

// Suscripción acotada para el Kanban: últimos 30 días → futuro ilimitado.
// Pedidos sin entregar de hasta 30 días atrás aparecen en la bandeja.
export const subscribeKanbanOrders = (
  callback: (orders: Order[]) => void,
  onError?: (error: Error) => void,
) => {
  const thirtyDaysAgo = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  const q = query(
    collection(db, ORDERS),
    where('date', '>=', thirtyDaysAgo),
    orderBy('date', 'asc'),
    limit(300),
  )
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
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  // Índice compuesto (driverId, date) ya existe en firestore.indexes.json
  const thirtyDaysAgo = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))

  const q = query(
    collection(db, ORDERS),
    where('driverId', '==', driverEmail),
    where('date', '>=', thirtyDaysAgo),
    orderBy('date', 'asc'),
    limit(100),
  )
  return onSnapshot(
    q,
    (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order))
      const filtered = all.filter((o) => {
        if (!['entregado', 'cancelado'].includes(o.status)) return true
        // entregados/cancelados: solo mostrar los de hoy
        const d = o.date?.toDate ? o.date.toDate() : new Date((o.date as any)?.seconds * 1000)
        return d >= todayStart
      })
      callback(filtered)
    },
    onError,
  )
}
