import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
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
    () => callback([]),
  )

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

export const subscribeVisitasPuntuales = (
  callback: (v: VisitaPuntual[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, PUNTUALES), orderBy('fecha', 'desc')),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as VisitaPuntual))),
    () => callback([]),
  )

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
