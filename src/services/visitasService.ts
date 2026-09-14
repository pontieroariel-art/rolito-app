import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import { ProgramaVisita, VisitaPuntual } from '../types'

const PROGRAMAS = 'programas-visita'
const PUNTUALES = 'visitas-puntuales'

// ── Programas recurrentes ─────────────────────────────────────────────────────

export const subscribeProgramas = (
  callback: (p: ProgramaVisita[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, PROGRAMAS), orderBy('clientName')),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProgramaVisita))),
    onSnapshotError(callback, 'programas-visita'),
  )

// ── Lo que ve el chofer (2026-09-14) ─────────────────────────────────────────
// El home del chofer bajaba la colección entera de programas y los 500 docs /
// 30 días de puntuales para quedarse con los suyos de la semana. Acá bajan
// solo los del chofer MÁS los sin chofer asignado (`driverId: null`), que el
// home también muestra (todos los que escriben una visita guardan el null
// explícito: Visitas y el supervisor). Son dos consultas por colección —una
// por email y otra por null— unidas en memoria, para no depender de cómo
// trata Firestore el null adentro de un `in`. Las dos usan el mismo índice
// compuesto (driverId + orden).

/** Une dos onSnapshot en un solo callback: avisa recién cuando llegaron los dos. */
function unirDosConsultas<T>(
  qA: ReturnType<typeof query>,
  qB: ReturnType<typeof query>,
  mapear: (d: { id: string; data: () => unknown }) => T,
  ordenar: (a: T, b: T) => number,
  callback: (items: T[]) => void,
  coleccion: string,
  alFallar?: (err: Error) => void,
): () => void {
  let a: T[] | null = null
  let b: T[] | null = null
  const emitir = () => { if (a && b) callback([...a, ...b].sort(ordenar)) }
  const onError = onSnapshotError(callback, coleccion, alFallar)
  const ua = onSnapshot(qA, (snap) => { a = snap.docs.map(mapear); emitir() }, onError)
  const ub = onSnapshot(qB, (snap) => { b = snap.docs.map(mapear); emitir() }, onError)
  return () => { ua(); ub() }
}

const porClientName = (x: ProgramaVisita, y: ProgramaVisita) =>
  x.clientName < y.clientName ? -1 : x.clientName > y.clientName ? 1 : 0
const porFechaDesc = (x: VisitaPuntual, y: VisitaPuntual) =>
  (y.fecha?.toMillis?.() ?? 0) - (x.fecha?.toMillis?.() ?? 0)

/** Programas del chofer (`driverId` = su email) más los sin chofer, ordenados por cliente. */
export const subscribeProgramasDeChofer = (
  driverEmail: string,
  callback: (p: ProgramaVisita[]) => void,
  alFallar?: (err: Error) => void,
): () => void =>
  unirDosConsultas<ProgramaVisita>(
    query(collection(db, PROGRAMAS), where('driverId', '==', driverEmail), orderBy('clientName')),
    query(collection(db, PROGRAMAS), where('driverId', '==', null), orderBy('clientName')),
    (d) => ({ id: d.id, ...(d.data() as object) } as ProgramaVisita),
    porClientName,
    callback,
    'programas-visita',
    alFallar,
  )

/** Visitas puntuales del chofer (más las sin chofer) con `fecha` en [desde, hasta), más nueva primero. */
export const subscribeVisitasPuntualesDeChofer = (
  driverEmail: string,
  desde: Date,
  hasta: Date,
  callback: (v: VisitaPuntual[]) => void,
  alFallar?: (err: Error) => void,
): () => void => {
  const tDesde = Timestamp.fromDate(desde)
  const tHasta = Timestamp.fromDate(hasta)
  const base = [where('fecha', '>=', tDesde), where('fecha', '<', tHasta), orderBy('fecha', 'desc')]
  return unirDosConsultas<VisitaPuntual>(
    query(collection(db, PUNTUALES), where('driverId', '==', driverEmail), ...base),
    query(collection(db, PUNTUALES), where('driverId', '==', null), ...base),
    (d) => ({ id: d.id, ...(d.data() as object) } as VisitaPuntual),
    porFechaDesc,
    callback,
    'visitas-puntuales',
    alFallar,
  )
}

export const addPrograma = (
  data: Omit<ProgramaVisita, 'id' | 'createdAt'>,
): Promise<void> =>
  addDoc(collection(db, PROGRAMAS), { ...data, createdAt: serverTimestamp() }).then(() => {})

export const updatePrograma = (
  id:   string,
  data: Partial<Omit<ProgramaVisita, 'id' | 'createdAt'>>,
): Promise<void> => updateDoc(doc(db, PROGRAMAS, id), data)

export const deletePrograma = (id: string): Promise<void> =>
  deleteDoc(doc(db, PROGRAMAS, id))

// ── Visitas puntuales ─────────────────────────────────────────────────────────

// Acotada a los últimos 30 días → futuro, igual que subscribeKanbanOrders:
// visitas-puntuales crece un documento por visita, sin este límite la
// colección entera se descarga en cada cliente que abre el panel/tablero.
export const subscribeVisitasPuntuales = (
  callback: (v: VisitaPuntual[]) => void,
): () => void => {
  const thirtyDaysAgo = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  return onSnapshot(
    query(
      collection(db, PUNTUALES),
      where('fecha', '>=', thirtyDaysAgo),
      orderBy('fecha', 'desc'),
      limit(500),
    ),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as VisitaPuntual))),
    onSnapshotError(callback, 'visitas-puntuales'),
  )
}

// Visitas puntuales con `fecha` en [desde, hasta] — versión por rango del
// stream de 30 días de arriba, para el Historial (/movimientos), que puede
// mirar cualquier mes/año. Query puntual (getDocs), no suscripción: es un
// reporte, no el tablero operativo.
export const getVisitasPuntualesInRange = async (desde: Date, hasta: Date): Promise<VisitaPuntual[]> => {
  const snap = await getDocs(query(
    collection(db, PUNTUALES),
    where('fecha', '>=', Timestamp.fromDate(desde)),
    where('fecha', '<=', Timestamp.fromDate(hasta)),
    orderBy('fecha', 'desc'),
  ))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as VisitaPuntual))
}

export const addVisitaPuntual = (
  data: Omit<VisitaPuntual, 'id' | 'createdAt'>,
): Promise<void> =>
  addDoc(collection(db, PUNTUALES), { ...data, createdAt: serverTimestamp() }).then(() => {})

export const updateVisitaPuntual = (
  id:   string,
  data: Partial<Omit<VisitaPuntual, 'id' | 'createdAt'>>,
): Promise<void> => updateDoc(doc(db, PUNTUALES, id), data)

export const deleteVisitaPuntual = (id: string): Promise<void> =>
  deleteDoc(doc(db, PUNTUALES, id))

// Helpers de fecha
export const toDateString = (t: Timestamp): string =>
  t.toDate().toISOString().split('T')[0]

export const todayTimestamp = (): Timestamp =>
  Timestamp.fromDate(new Date(new Date().toDateString()))
