import {
  collection, doc, getDoc, onSnapshot, query, runTransaction, updateDoc, where, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { PLANTA_INFO } from '../utils/constants'
import type { PlantaId, Rendicion } from '../types'

// Rendiciones (2026-09-09): cierre de caja por persona y día. Mismo patrón que
// liquidaciones (id determinístico, create-only) y que el remito de carga
// (número correlativo por planta dentro de la transacción). Caja está online:
// se espera al servidor, y el contador exige transacción.

const RENDICIONES = 'rendiciones'
const COUNTER_REF = (plantaId: PlantaId) => doc(db, 'config', `rendicionCounter_${plantaId}`)

export const rendicionId = (fecha: string, sujetoId: string) => `${fecha}_${sujetoId}`
export const codigoRendicion = (plantaId: PlantaId, numero: number): string =>
  `RD-${PLANTA_INFO[plantaId].prefijoCodigo}-${String(numero).padStart(6, '0')}`

export class RendicionYaCerradaError extends Error {
  constructor() { super('La caja de este día ya está cerrada.') }
}

export type DatosRendicionMostrador = Omit<Rendicion, 'id' | 'numero' | 'codigo' | 'tipo' | 'createdAt' | 'validacion' | 'entregaId' | 'cerradaPor'>

/** Cierra la caja del día del cajero: toma el número, crea el doc. Falla si ya estaba cerrada. */
export async function crearRendicionMostrador(datos: DatosRendicionMostrador, actor: { uid: string; nombre: string }): Promise<Rendicion> {
  const id = rendicionId(datos.fecha, datos.sujetoId)
  const ref = doc(db, RENDICIONES, id)
  const data = await runTransaction(db, async (tx) => {
    const [existente, counterSnap] = await Promise.all([tx.get(ref), tx.get(COUNTER_REF(datos.plantaId))])
    if (existente.exists()) throw new RendicionYaCerradaError()
    const numero = counterSnap.exists() ? (counterSnap.data().next as number) : 1
    tx.set(COUNTER_REF(datos.plantaId), { next: numero + 1 })
    const rendicion: Omit<Rendicion, 'id'> = {
      ...datos,
      numero,
      codigo:     codigoRendicion(datos.plantaId, numero),
      tipo:       'mostrador',
      cerradaPor: actor,
      createdAt:  Timestamp.now(),
      validacion: null,
      entregaId:  null,
    }
    tx.set(ref, rendicion)
    return rendicion
  })
  return { id, ...data }
}

// La rendición del día de una persona, en vivo. Un error de lectura NO se
// traga como null: la UI creería que no está cerrada y dejaría cerrar de nuevo.
export const subscribeRendicion = (
  fecha: string,
  sujetoId: string,
  callback: (r: Rendicion | null) => void,
): () => void =>
  onSnapshot(
    doc(db, RENDICIONES, rendicionId(fecha, sujetoId)),
    (snap) => callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Rendicion) : null),
    (err) => { reportError(err, { subscription: 'rendiciones', fecha, sujetoId }); callback(null) },
  )

// Todas las rendiciones cuya fecha (yyyy-MM-dd) cae en [desde, hasta). Rango
// sobre un solo campo: sin índice compuesto; planta/tipo se filtran en cliente.
export const subscribeRendicionesEnRango = (
  desde: string,
  hasta: string,
  callback: (rendiciones: Rendicion[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, RENDICIONES), where('fecha', '>=', desde), where('fecha', '<', hasta)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Rendicion)),
    (err) => { reportError(err, { subscription: 'rendiciones-rango', desde, hasta }); callback([]) },
  )

/** Rendiciones de una persona en varios días (ids determinísticos, un getDoc por día). */
export async function getRendicionesDeSujeto(sujetoId: string, fechas: string[]): Promise<Rendicion[]> {
  const snaps = await Promise.all(fechas.map((f) => getDoc(doc(db, RENDICIONES, rendicionId(f, sujetoId)))))
  return snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }) as Rendicion)
}

/** Tesorería revisó el cierre (único campo que escribe; una sola vez). */
export const validarRendicion = (id: string, actor: { uid: string; nombre: string }, nota?: string): Promise<void> =>
  updateDoc(doc(db, RENDICIONES, id), {
    validacion: { uid: actor.uid, nombre: actor.nombre, fecha: Timestamp.now(), ...(nota?.trim() ? { nota: nota.trim() } : {}) },
  })
