import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  updateDoc,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import { PanolArticulo, PanolMovimiento, PanolMovimientoArticulo, UserRole } from '../types'

const ARTICULOS   = 'panolArticulos'
const MOVIMIENTOS = 'panolMovimientos'

export interface Actor { uid: string; nombre: string }

export class StockInsuficienteError extends Error {}

// ── Artículos ────────────────────────────────────────────────────────────────

export const subscribeArticulos = (
  callback: (articulos: PanolArticulo[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, ARTICULOS), orderBy('nombre'), limit(500)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PanolArticulo))),
    onSnapshotError(callback, 'panolArticulos'),
  )

export const crearArticulo = (data: {
  nombre: string
  codigoBarras: string
  unidad: string
  stockMinimo: number
  stockMaximo: number
}): Promise<void> =>
  runTransaction(db, async (tx) => {
    const ref = doc(collection(db, ARTICULOS))
    tx.set(ref, {
      ...data,
      stockActual: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })

export const actualizarArticulo = (
  id: string,
  data: Partial<{ nombre: string; codigoBarras: string; unidad: string; stockMinimo: number; stockMaximo: number }>,
): Promise<void> =>
  updateDoc(doc(db, ARTICULOS, id), { ...data, updatedAt: serverTimestamp() })

// ── Movimientos ──────────────────────────────────────────────────────────────

export const subscribeMovimientosRecientes = (
  callback: (movimientos: PanolMovimiento[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, MOVIMIENTOS), orderBy('fecha', 'desc'), limit(100)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PanolMovimiento))),
    onSnapshotError(callback, 'panolMovimientos'),
  )

export const subscribeMovimientosAsignadosA = (
  uid: string,
  callback: (movimientos: PanolMovimiento[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, MOVIMIENTOS), where('destinatario.uid', '==', uid), orderBy('fecha', 'desc'), limit(50)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PanolMovimiento))),
    onSnapshotError(callback, 'panolMovimientos'),
  )

// Entrega a un técnico: descuenta stock de cada artículo. La firma se
// confirma después, desde el panel del técnico (registrarEntrega no la pide
// — puede hacerse el traspaso sin que estén los dos en el mismo lugar).
export const registrarEntrega = (
  articulos: PanolMovimientoArticulo[],
  destinatario: { uid: string; nombre: string; rol: UserRole },
  actor: Actor,
): Promise<PanolMovimiento> =>
  runTransaction(db, async (tx) => {
    const refs = articulos.map((a) => doc(db, ARTICULOS, a.articuloId))
    const snaps = await Promise.all(refs.map((r) => tx.get(r)))
    snaps.forEach((snap, i) => {
      const actual = (snap.data()?.stockActual as number) ?? 0
      if (actual < articulos[i].cantidad) {
        throw new StockInsuficienteError(`No hay stock suficiente de "${articulos[i].nombre}" (quedan ${actual}).`)
      }
    })
    snaps.forEach((snap, i) => {
      const actual = (snap.data()?.stockActual as number) ?? 0
      tx.update(refs[i], { stockActual: actual - articulos[i].cantidad, updatedAt: serverTimestamp() })
    })
    const fecha = Timestamp.now()
    const movRef = doc(collection(db, MOVIMIENTOS))
    const mov: Omit<PanolMovimiento, 'id'> = {
      tipo: 'entrega',
      articulos,
      destinatario,
      confirmado: false,
      firmaDataUrl: null,
      confirmadoAt: null,
      actor,
      fecha,
    }
    tx.set(movRef, mov)
    return { id: movRef.id, ...mov }
  })

// Recepción de mercadería: suma stock, sin destinatario ni firma.
export const registrarRecepcion = (
  articulos: PanolMovimientoArticulo[],
  actor: Actor,
): Promise<void> =>
  runTransaction(db, async (tx) => {
    const refs = articulos.map((a) => doc(db, ARTICULOS, a.articuloId))
    const snaps = await Promise.all(refs.map((r) => tx.get(r)))
    snaps.forEach((snap, i) => {
      const actual = (snap.data()?.stockActual as number) ?? 0
      tx.update(refs[i], { stockActual: actual + articulos[i].cantidad, updatedAt: serverTimestamp() })
    })
    const movRef = doc(collection(db, MOVIMIENTOS))
    tx.set(movRef, {
      tipo: 'recepcion',
      articulos,
      destinatario: null,
      confirmado: true,
      firmaDataUrl: null,
      confirmadoAt: null,
      actor,
      fecha: serverTimestamp(),
    })
  })

// Baja confianza — el técnico firma para confirmar que recibió lo suyo.
export const confirmarRecepcionTecnico = (
  movimientoId: string,
  firmaDataUrl: string,
): Promise<void> =>
  updateDoc(doc(db, MOVIMIENTOS, movimientoId), {
    confirmado: true,
    firmaDataUrl,
    confirmadoAt: serverTimestamp(),
  })
