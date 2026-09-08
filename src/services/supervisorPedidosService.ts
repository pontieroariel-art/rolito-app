import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { direccionPrincipal } from '@/utils/contacto'
import type { OrderProduct, UserProfile } from '@/types'

// Pedido o visita que el supervisor le pasa a logística desde la ficha del
// cliente (2026-09-07). Ninguno lleva chofer ni día: el pedido entra a la
// Bandeja (convención de Planificación: date = ayer 12:00, ver
// moveOrderToBandeja) y la visita queda pendiente sin asignar. Logística los
// programa desde sus pantallas; el trigger de functions les avisa por push.

export interface ActorSupervisor { uid: string; nombre: string }

const fechaBandeja = (): Timestamp => {
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  ayer.setHours(12, 0, 0, 0)
  return Timestamp.fromDate(ayer)
}

export async function crearPedidoDesdeSupervisor(
  cliente: UserProfile,
  products: OrderProduct[],
  notas: string,
  actor: ActorSupervisor,
): Promise<string> {
  const dir = direccionPrincipal(cliente)
  const ref = await addDoc(collection(db, 'orders'), {
    clientId:      cliente.uid,
    clientEmail:   cliente.email ?? '',
    clientName:    cliente.razonSocial || cliente.nombre || '',
    clientAddress: dir?.address ?? '',
    clientPhone:   cliente.telefono || cliente.phone || '',
    products,
    status:        'pendiente',
    date:          fechaBandeja(),
    driverId:      null,
    notes:         notas.trim(),
    origenSupervisor: actor,
    ...(cliente.codigoTango ? { codigoCliente: cliente.codigoTango } : {}),
    createdAt:     serverTimestamp(),
    updatedAt:     serverTimestamp(),
  })
  return ref.id
}

export async function crearVisitaDesdeSupervisor(
  cliente: UserProfile,
  notas: string,
  actor: ActorSupervisor,
): Promise<string> {
  const dir = direccionPrincipal(cliente)
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0)
  const ref = await addDoc(collection(db, 'visitas-puntuales'), {
    clientId:      cliente.uid,
    clientName:    cliente.razonSocial || cliente.nombre || '',
    clientAddress: dir?.address ?? '',
    clientPhone:   cliente.telefono || cliente.phone || '',
    fecha:         Timestamp.fromDate(hoy),
    driverId:      null,
    status:        'pendiente',
    notas:         notas.trim(),
    origenSupervisor: actor,
    createdAt:     serverTimestamp(),
  })
  return ref.id
}
