import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where, type Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import type { PersonaTurno, PlantaId } from '@/types'
import { TURNOS_POR_DEFECTO, type TurnoProduccionDef } from '@/utils/turnosProduccion'

// Datos del panel del encargado de producción y de la tablet (2026-09-25):
// turnos editables por planta, estado de la tablet y resumen de ventas.

// ── Turnos ───────────────────────────────────────────────────────────────────

const refTurnos = (planta: PlantaId) => doc(db, 'config', `produccionTurnos_${planta}`)

/** Turnos de la planta; sin documento, los de siempre (6-14, 14-22, 22-6). */
export function subscribeTurnosPlanta(planta: PlantaId, cb: (turnos: TurnoProduccionDef[]) => void): () => void {
  return onSnapshot(
    refTurnos(planta),
    (snap) => {
      const t = snap.data()?.turnos as TurnoProduccionDef[] | undefined
      cb(Array.isArray(t) && t.length ? t : TURNOS_POR_DEFECTO)
    },
    onSnapshotError(() => cb(TURNOS_POR_DEFECTO), `produccionTurnos_${planta}`),
  )
}

export async function guardarTurnosPlanta(planta: PlantaId, turnos: TurnoProduccionDef[], uid: string): Promise<void> {
  // Sin campos undefined (Firestore los rechaza): capitán null y operarios [] explícitos.
  const limpios = turnos.map((t) => ({
    nombre: t.nombre.trim(), desde: t.desde, hasta: t.hasta,
    capitan: t.capitan ?? null, operarios: t.operarios ?? [],
  }))
  await setDoc(refTurnos(planta), { turnos: limpios, actualizadoPor: uid, actualizadoEn: serverTimestamp() })
}

// ── Estado de la tablet ──────────────────────────────────────────────────────

export interface EstadoTablet {
  operario:        PersonaTurno
  impresora:       { estado: string; nombre: string | null }
  enCola:          number
  ultimaActividad: Timestamp | null
}

export function subscribeEstadoTablet(planta: PlantaId, cb: (e: EstadoTablet | null) => void): () => void {
  return onSnapshot(
    doc(db, 'produccionTablets', planta),
    (snap) => cb(snap.exists() ? (snap.data() as EstadoTablet) : null),
    onSnapshotError(() => cb(null), `produccionTablets_${planta}`),
  )
}

/** La tablet avisa quién está, cómo está la Zebra y cuántas etiquetas esperan. */
export async function publicarEstadoTablet(planta: PlantaId, datos: Omit<EstadoTablet, 'ultimaActividad'>): Promise<void> {
  await setDoc(doc(db, 'produccionTablets', planta), { ...datos, ultimaActividad: serverTimestamp() })
}

// ── Ventas por producto (las resume el server cada 15 minutos) ──────────────

export interface VentasProductoDia {
  fecha:     string
  /** planta → producto de producción → unidades vendidas. */
  porPlanta: Record<string, Record<string, number>>
}

export function subscribeVentasProducto(desde: string, hasta: string, cb: (dias: VentasProductoDia[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'rollupsVentasProducto'), where('fecha', '>=', desde), where('fecha', '<=', hasta)),
    (snap) => cb(snap.docs.map((d) => d.data() as VentasProductoDia)),
    onSnapshotError(() => cb([]), 'rollupsVentasProducto'),
  )
}
