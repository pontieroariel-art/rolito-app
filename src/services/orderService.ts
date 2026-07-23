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
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { Order, OrderProduct, UserProfile, getPrimaryAddress } from '../types'
import { tsToDate } from '../utils/helpers'

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
  user:       UserProfile
  products:   OrderProduct[]
  date:       string
  notes:      string
  address?:   string
  esUrgente?: boolean
}

function buildCreateOrderData({ user, products, date, notes, address, esUrgente }: CreateOrderParams) {
  const primaryAddr    = getPrimaryAddress(user)
  const clientAddress  = address               || primaryAddr?.address || user.address  || ''
  const clientName     = user.razonSocial      || user.nombre   || ''
  const clientPhone    = user.telefono         || user.phone    || ''
  return {
    clientId:    user.uid,
    clientEmail: user.email,
    clientName,
    clientAddress,
    clientPhone,
    products,
    status:    'pendiente' as const,
    date:      Timestamp.fromDate(new Date(date + 'T12:00:00')),
    driverId:  null,
    notes:     notes || '',
    ...(esUrgente ? { esUrgente: true } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
}

export const createOrder = (params: CreateOrderParams) =>
  addDoc(collection(db, ORDERS), buildCreateOrderData(params))

function dateStrToTimestamp(dateStr: string): Timestamp {
  return Timestamp.fromDate(new Date(dateStr + 'T12:00:00'))
}

// Si el formato de OC no trae una fecha tope explícita (vigencia), se calcula
// por defecto como la fecha de entrega + 1 día (mismo criterio que usa Coto,
// el único proveedor que sí la declara explícitamente en el PDF).
function resolveFechaTope(deliveryDateStr: string, fechaTope?: string): Timestamp {
  if (fechaTope) return dateStrToTimestamp(fechaTope)
  const d = new Date(deliveryDateStr + 'T12:00:00')
  d.setDate(d.getDate() + 1)
  return Timestamp.fromDate(d)
}

export const createOrderManual = ({
  cliente, clientLabel, products, date, notes, address, ordenCompra, horaEntrega, fechaEmision,
}: {
  cliente:       UserProfile
  clientLabel?:  string
  products:      OrderProduct[]
  date:          string
  notes:         string
  address:       string
  ordenCompra?:  string
  horaEntrega?:  string
  fechaEmision?: string
}) =>
  addDoc(collection(db, ORDERS), {
    clientId:      cliente.uid,
    clientEmail:   cliente.email,
    clientName:    clientLabel || cliente.razonSocial || cliente.nombre || '',
    clientAddress: address,
    clientPhone:   cliente.telefono   || cliente.phone  || '',
    products,
    status:       'pendiente',
    date:         Timestamp.fromDate(new Date(date + 'T12:00:00')),
    driverId:     null,
    notes:        notes || '',
    origenManual: true,
    ...(ordenCompra ? { numeroOC: ordenCompra } : {}),
    ...(horaEntrega ? { horaEntrega } : {}),
    ...(ordenCompra ? {
      ...(fechaEmision ? { fechaEmision: dateStrToTimestamp(fechaEmision) } : {}),
      fechaTope: resolveFechaTope(date, undefined),
    } : {}),
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
  fechaEmision?: string
  fechaTope?:    string
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
    ...(params.fechaEmision ? { fechaEmision: dateStrToTimestamp(params.fechaEmision) } : {}),
    fechaTope:     resolveFechaTope(params.date, params.fechaTope),
    createdAt:     serverTimestamp(),
    updatedAt:     serverTimestamp(),
  })

export const updateOrderStatus = (orderId: string, status: string): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), { status, updatedAt: serverTimestamp() })

// Igual que updateOrderStatus, pero para varios pedidos a la vez en una única
// operación atómica — usado al confirmar/reabrir un despacho completo, en vez
// de disparar N escrituras individuales en paralelo.
export const updateOrdersStatusBatch = async (orderIds: string[], status: string): Promise<void> => {
  if (orderIds.length === 0) return
  const batch = writeBatch(db)
  orderIds.forEach((id) => batch.update(doc(db, ORDERS, id), { status, updatedAt: serverTimestamp() }))
  await batch.commit()
}

function buildCancelFields(motivo: string) {
  return {
    status:            'cancelado' as const,
    motivoCancelacion: motivo,
    updatedAt:         serverTimestamp(),
  }
}

export const cancelOrder = (orderId: string, motivo: string): Promise<void> =>
  updateDoc(doc(db, ORDERS, orderId), buildCancelFields(motivo))

// Cancela el pedido original y crea uno nuevo con los datos ajustados, en un
// único batch atómico. Nunca se edita el pedido original in-place: se
// preserva para trazabilidad/logística y el nuevo queda enlazado por
// pedidoOriginalId.
export const cancelAndRecreateOrder = async (
  originalOrderId: string,
  newOrderParams:  CreateOrderParams,
  motivo = 'Modificado por el cliente',
): Promise<string> => {
  const batch = writeBatch(db)
  batch.update(doc(db, ORDERS, originalOrderId), buildCancelFields(motivo))

  const newRef = doc(collection(db, ORDERS))
  batch.set(newRef, {
    ...buildCreateOrderData(newOrderParams),
    pedidoOriginalId: originalOrderId,
  })

  await batch.commit()
  return newRef.id
}

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

export const moveOrderToBandeja = (orderId: string): Promise<void> => {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(12, 0, 0, 0)
  return updateDoc(doc(db, ORDERS, orderId), {
    date:      Timestamp.fromDate(yesterday),
    updatedAt: serverTimestamp(),
  })
}

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
  numeroOC?:   string
}

export const editOrderBy = (orderId: string, params: EditOrderParams, actor: Actor): Promise<void> => {
  const detalle = `Productos/fecha/hora actualizados`
  return updateDoc(doc(db, ORDERS, orderId), {
    products:    params.products,
    date:        Timestamp.fromDate(new Date(params.date + 'T12:00:00')),
    horaEntrega: params.horaEntrega || null,
    notes:       params.notes,
    numeroOC:    params.numeroOC?.trim() || null,
    updatedAt:   serverTimestamp(),
    historialAcciones: arrayUnion(accion(actor, 'modificado', detalle)),
  })
}

// Pedidos activos (no cancelados) de un cliente para una fecha de entrega dada,
// en la MISMA dirección de entrega. Usado para avisar de posibles duplicados
// antes de crear un pedido manual o por PDF.
// El filtro por dirección es necesario para clientes "grupo empresario" (un
// CUIT, varias sucursales): sin él, cargar un pedido para una sucursal
// avisaba "ya existe un pedido" solo porque OTRA sucursal del mismo cliente
// ya tenía uno ese día.
export const findActiveOrdersSameDay = async (clientId: string, dateStr: string, address: string): Promise<Order[]> => {
  const dayStart = Timestamp.fromDate(new Date(dateStr + 'T00:00:00'))
  const dayEnd   = Timestamp.fromDate(new Date(dateStr + 'T23:59:59'))
  const q = query(
    collection(db, ORDERS),
    where('clientId', '==', clientId),
    where('date', '>=', dayStart),
    where('date', '<=', dayEnd),
  )
  const snap = await getDocs(q)
  const normalizedAddress = address.trim().toLowerCase()
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Order))
    .filter((o) => o.status !== 'cancelado' && o.clientAddress.trim().toLowerCase() === normalizedAddress)
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

// Búsqueda puntual (no en tiempo real) por prefijo de un campo, sin
// restricción de fecha — para encontrar pedidos fuera de la ventana del
// Kanban (más de 30 días atrás o fuera del límite de 300).
async function searchOrdersByPrefix(field: 'clientName' | 'numeroOC', term: string): Promise<Order[]> {
  const t = term.trim()
  if (!t) return []
  // Firestore no soporta "contiene" ni case-insensitive nativo: se prueba el
  // texto tal cual y en MAYÚSCULAS para cubrir clientes cargados por OCR/PDF.
  const variants = Array.from(new Set([t, t.toUpperCase()]))
  const snaps = await Promise.all(variants.map((v) => getDocs(query(
    collection(db, ORDERS),
    orderBy(field),
    where(field, '>=', v),
    where(field, '<', v + ''),
    limit(15),
  ))))
  const byId = new Map<string, Order>()
  snaps.forEach((snap) => snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() } as Order)))
  return Array.from(byId.values()).sort((a, b) => (b.date?.seconds ?? 0) - (a.date?.seconds ?? 0))
}

export const searchOrdersByClientName = (term: string): Promise<Order[]> => searchOrdersByPrefix('clientName', term)
export const searchOrdersByNumeroOC   = (term: string): Promise<Order[]> => searchOrdersByPrefix('numeroOC', term)

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// Pedidos no guardan el código de cliente — se resuelve primero código →
// clientId contra la colección users, y recién ahí se buscan los pedidos.
export async function searchOrdersByClientCode(term: string): Promise<Order[]> {
  const t = term.trim()
  if (!t) return []
  const variants = Array.from(new Set([t, t.toUpperCase()]))
  const userSnaps = await Promise.all(variants.map((v) => getDocs(query(
    collection(db, 'users'),
    orderBy('codigoCliente'),
    where('codigoCliente', '>=', v),
    where('codigoCliente', '<', v + ''),
    limit(10),
  ))))
  const clientIds = Array.from(new Set(userSnaps.flatMap((snap) => snap.docs.map((d) => d.id))))
  if (clientIds.length === 0) return []

  // Firestore 'in' soporta hasta 30 valores por query
  const orderSnaps = await Promise.all(
    chunk(clientIds, 30).map((ids) => getDocs(query(
      collection(db, ORDERS),
      where('clientId', 'in', ids),
      limit(30),
    ))),
  )
  const byId = new Map<string, Order>()
  orderSnaps.forEach((snap) => snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() } as Order)))
  return Array.from(byId.values()).sort((a, b) => (b.date?.seconds ?? 0) - (a.date?.seconds ?? 0))
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
        const d = tsToDate(o.date)
        return d >= todayStart
      })
      callback(filtered)
    },
    onError,
  )
}
