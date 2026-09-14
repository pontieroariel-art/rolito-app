import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import type { ClienteIndex } from '@/types'

// Índice liviano de clientes activos para buscar (2026-09-10): lo mantiene el
// trigger onClienteIndexado a partir de users. Con la caché persistente de
// Firestore, la suscripción sirve desde el teléfono al instante y después solo
// bajan los clientes que cambiaron. La ficha completa (precios, condición de
// venta, domicilios) se pide por id recién al elegir el cliente.

// El índice entero, sin filtrar por estado (2026-09-14): para las pantallas de
// escritorio que cruzan pedidos históricos con su cliente (Pedidos de
// comercial, Historial de flota), donde un cliente dado de baja o pendiente
// también tiene que aparecer. El backfill y el trigger indexan a TODO cliente
// con su `estado`, así que el conjunto es el mismo que `users` con rol cliente.
export function subscribeClientesIndexTodos(
  cb: (clientes: ClienteIndex[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'clientesIndex'),
    (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<ClienteIndex, 'uid'>), uid: d.id }))),
    (err) => { onSnapshotError(cb, 'clientesIndex:todos')(err); onError?.(err) },
  )
}

export function subscribeClientesIndex(
  cb: (clientes: ClienteIndex[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(collection(db, 'clientesIndex'), where('estado', '==', 'activo'))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<ClienteIndex, 'uid'>), uid: d.id }))),
    (err) => { onSnapshotError(cb, 'clientesIndex')(err); onError?.(err) },
  )
}
