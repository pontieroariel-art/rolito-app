import {
  collection, doc, onSnapshot, query, setDoc, updateDoc, where, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import type { DesvioDescarga, MotivoDesvioDescarga, PlantaId } from '../types'
import type { FaltanteCalculado } from '../utils/faltantes'

// Pedido de autorización de un faltante de mercadería (2026-09-13, paso 7 del
// control de fugas). Molde de anulacionesVentanilla: un doc por día y
// repartidor, id determinístico, y quien autoriza no puede ser el que pidió.
//
// Caja pide desde la liquidación; el que tiene el permiso lo resuelve desde la
// bandeja de anulaciones. Mientras no haya respuesta, caja puede cerrar igual
// con "desvío observado": esto es el camino limpio, no una tranca.

const DESVIOS = 'desviosDescarga'

export const desvioId = (fecha: string, choferId: string): string => `${fecha}_${choferId}`

export async function pedirAutorizacionDesvio(
  args: {
    fecha:          string
    choferId:       string
    choferNombre:   string
    depositoTango?: string
    faltante:       FaltanteCalculado
    umbral:         number
    motivo:         MotivoDesvioDescarga
    nota:           string
  },
  actor: { uid: string; nombre: string; plantaId: PlantaId },
): Promise<void> {
  const id = desvioId(args.fecha, args.choferId)
  // Se espera al servidor: caja está online y tiene que ver el estado real
  // antes de decidir si cierra observado o espera la autorización.
  await setDoc(doc(db, DESVIOS, id), {
    fecha:           args.fecha,
    plantaId:        actor.plantaId,
    choferId:        args.choferId,
    choferNombre:    args.choferNombre,
    ...(args.depositoTango ? { depositoTango: args.depositoTango } : {}),
    bolsasFaltantes: args.faltante.bolsasFaltantes,
    productos:       args.faltante.productos,
    umbral:          args.umbral,
    estado:          'pendiente',
    motivo:          args.motivo,
    nota:            args.nota,
    solicitadoPor:   { uid: actor.uid, nombre: actor.nombre },
    solicitadaEn:    Timestamp.now(),
    resueltaPor:     null,
  })
}

/** Aprobar o rechazar. Rechazar exige nota: el que pidió tiene que saber qué hacer. */
export const resolverDesvio = (
  id: string,
  estado: 'aprobada' | 'rechazada',
  actor: { uid: string; nombre: string },
  notaResolucion: string,
): Promise<void> =>
  updateDoc(doc(db, DESVIOS, id), {
    estado,
    resueltaPor: { uid: actor.uid, nombre: actor.nombre },
    resueltaEn:  Timestamp.now(),
    notaResolucion,
  })

/** El desvío de un día y repartidor (la pantalla de caja mira el suyo). */
export const subscribeDesvio = (
  fecha: string,
  choferId: string,
  callback: (d: DesvioDescarga | null) => void,
): (() => void) =>
  onSnapshot(
    doc(db, DESVIOS, desvioId(fecha, choferId)),
    (snap) => callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as DesvioDescarga) : null),
    onSnapshotError(() => callback(null), 'desviosDescarga'),
  )

/** Los pendientes (bandeja de autorización). */
export const subscribeDesviosPendientes = (
  callback: (ds: DesvioDescarga[]) => void,
): (() => void) =>
  onSnapshot(
    query(collection(db, DESVIOS), where('estado', '==', 'pendiente')),
    (snap) => callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as DesvioDescarga))
        .sort((a, b) => b.solicitadaEn.toMillis() - a.solicitadaEn.toMillis()),
    ),
    onSnapshotError(callback, 'desviosDescarga'),
  )
