import { collection, doc, getDocs, onSnapshot, query, runTransaction, where, Timestamp } from 'firebase/firestore'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { sesionId } from '@/utils/sobres'
import type { CajaSesion, PlantaId } from '@/types'

// Turno de caja (2026-09-14, rendición de fondos, Fase 1): cada cajero abre SU
// turno al empezar y lo cierra rindiendo un sobre a tesorería
// (`sobreService.cerrarTurnoYRendir`). Id determinístico `{fecha}_{uid}_{n}`:
// n = 1 el primero del día, n + 1 si reabre después de cerrar. Las reglas
// exigen que la `_(n-1)` esté cerrada, así que acá se recorren los ids del día
// adentro de la transacción (el SDK web no permite queries en transacción, y
// con ids determinísticos no hace falta).

const SESIONES = 'cajaSesiones'
/** Más de esto en un día no es un cajero reabriendo, es un bug. */
const MAX_TURNOS_POR_DIA = 20

export const cajaSesionId = (fecha: string, uid: string, n: number): string => sesionId(fecha, uid, n)

export class SesionYaAbiertaError extends Error {
  constructor(public readonly sesion: CajaSesion) { super('Ya tenés un turno abierto. Cerralo antes de abrir otro.') }
}

const aSesion = (d: QueryDocumentSnapshot<DocumentData> | { id: string; data: () => DocumentData | undefined }): CajaSesion =>
  ({ id: d.id, ...(d.data() as object) }) as CajaSesion

/**
 * Abre el turno n del cajero: 1 si todavía no abrió hoy, o el siguiente al
 * último cerrado. Si encuentra uno abierto tira `SesionYaAbiertaError` (la
 * pantalla lo retoma en vez de abrir otro). Fondo inicial 0: hoy no hay fondo
 * fijo (decisión de Ariel, 14/09); si algún día lo hay, lo carga tesorería.
 */
export async function abrirTurno(actor: { uid: string; nombre: string }, plantaId: PlantaId, fecha: string): Promise<CajaSesion> {
  return runTransaction(db, async (tx) => {
    let n = 1
    for (; n <= MAX_TURNOS_POR_DIA; n++) {
      const snap = await tx.get(doc(db, SESIONES, cajaSesionId(fecha, actor.uid, n)))
      if (!snap.exists()) break
      const existente = aSesion(snap)
      if (existente.estado === 'abierta') throw new SesionYaAbiertaError(existente)
    }
    if (n > MAX_TURNOS_POR_DIA) throw new Error('Demasiados turnos abiertos hoy. Avisá a tesorería.')
    const id = cajaSesionId(fecha, actor.uid, n)
    const sesion: Omit<CajaSesion, 'id'> = {
      plantaId,
      cajero:         { uid: actor.uid, nombre: actor.nombre },
      fecha,
      numero:         n,
      estado:         'abierta',
      abiertaEn:      Timestamp.now(),
      fondoInicial:   0,
      fondoInicialDe: null,
    }
    tx.set(doc(db, SESIONES, id), sesion)
    return { id, ...sesion }
  })
}

/**
 * La sesión ABIERTA de hoy del cajero, o null. Dos igualdades (sin índice
 * compuesto) y el estado se filtra en cliente: como mucho son un par de docs.
 * Un error de lectura se reporta y se entrega null: la pantalla ofrecería
 * "Abrir turno", pero `abrirTurno` es transaccional y rebota si ya hay uno.
 */
export const subscribeSesionAbierta = (
  uid: string,
  fecha: string,
  cb: (s: CajaSesion | null) => void,
  alFallar?: (err: Error) => void,
): () => void =>
  onSnapshot(
    query(collection(db, SESIONES), where('cajero.uid', '==', uid), where('fecha', '==', fecha)),
    (snap) => {
      const abiertas = snap.docs.map(aSesion).filter((s) => s.estado === 'abierta').sort((a, b) => b.numero - a.numero)
      cb(abiertas[0] ?? null)
    },
    (err) => { reportError(err, { subscription: 'cajaSesiones-abierta', uid, fecha }); cb(null); alFallar?.(err) },
  )

/** Todas las sesiones del día de una planta (tesorería: qué cajas están abiertas). */
export const subscribeSesionesDelDia = (
  plantaId: PlantaId,
  fecha: string,
  cb: (s: CajaSesion[]) => void,
  alFallar?: (err: Error) => void,
): () => void =>
  onSnapshot(
    query(collection(db, SESIONES), where('plantaId', '==', plantaId), where('fecha', '==', fecha)),
    (snap) => cb(snap.docs.map(aSesion).sort(porAbiertaEn)),
    (err) => { reportError(err, { subscription: 'cajaSesiones-dia', plantaId, fecha }); cb([]); alFallar?.(err) },
  )

/** Las sesiones de un cajero en un día, en orden de apertura. */
export async function getSesionesDe(uid: string, fecha: string): Promise<CajaSesion[]> {
  const snap = await getDocs(query(collection(db, SESIONES), where('cajero.uid', '==', uid), where('fecha', '==', fecha)))
  return snap.docs.map(aSesion).sort((a, b) => a.numero - b.numero)
}

const porAbiertaEn = (a: CajaSesion, b: CajaSesion): number => a.abiertaEn.toMillis() - b.abiertaEn.toMillis()
