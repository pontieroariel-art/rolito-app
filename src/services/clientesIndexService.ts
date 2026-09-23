import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore'
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

// Lectura puntual del índice entero para los servicios que no viven en un
// componente (búsqueda de pedidos por código de sucursal, 2026-09-22). Memo de
// 5 minutos, como getAllUsers, pero con docs de menos de 1 KB en vez de la
// ficha con precios.
let _indiceCache: ClienteIndex[] | null = null
let _indiceCacheTime = 0
const INDICE_TTL = 5 * 60 * 1000

export async function getClientesIndexTodos(): Promise<ClienteIndex[]> {
  if (_indiceCache && Date.now() - _indiceCacheTime < INDICE_TTL) return _indiceCache
  const snap = await getDocs(collection(db, 'clientesIndex'))
  _indiceCache = snap.docs.map((d) => ({ ...(d.data() as Omit<ClienteIndex, 'uid'>), uid: d.id }))
  _indiceCacheTime = Date.now()
  return _indiceCache
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
