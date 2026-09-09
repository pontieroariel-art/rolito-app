import { collection, doc, getDoc, onSnapshot, query, runTransaction, updateDoc, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { PLANTA_INFO } from '../utils/constants'
import type { EntregaTesoreria, PlantaId } from '../types'

// Entregas de caja a tesorería (2026-09-09). Mismo patrón que rendiciones:
// número correlativo por planta dentro de la transacción, doc create-only
// salvo la confirmación de tesorería. La transacción también marca
// `entregaId` en cada liquidación y cierre incluido, así no salen dos veces.

const ENTREGAS = 'entregasTesoreria'
const COUNTER_REF = (plantaId: PlantaId) => doc(db, 'config', `entregaCounter_${plantaId}`)

export const entregaId = (fecha: string, plantaId: PlantaId, numero: number) => `${fecha}_${plantaId}_${numero}`
export const codigoEntrega = (plantaId: PlantaId, numero: number): string =>
  `ET-${PLANTA_INFO[plantaId].prefijoCodigo}-${String(numero).padStart(6, '0')}`

export class EntregaYaIncluidaError extends Error {
  constructor(public readonly que: string) { super(`${que} ya salió en otra entrega. Actualizá la pantalla.`) }
}

export type DatosEntrega = Omit<EntregaTesoreria, 'id' | 'numero' | 'codigo' | 'estado' | 'destino' | 'entregadoPor' | 'createdAt' | 'recibidoPor'>

/** Caja arma la entrega: toma el número, crea el doc y marca las liquidaciones y cierres incluidos. */
export async function crearEntrega(datos: DatosEntrega, actor: { uid: string; nombre: string }): Promise<EntregaTesoreria> {
  const liqRefs  = datos.liquidacionIds.map((id) => doc(db, 'liquidaciones', id))
  const rendRefs = datos.rendicionIds.map((id) => doc(db, 'rendiciones', id))
  return runTransaction(db, async (tx) => {
    const [counterSnap, ...snaps] = await Promise.all([tx.get(COUNTER_REF(datos.plantaId)), ...liqRefs.map((r) => tx.get(r)), ...rendRefs.map((r) => tx.get(r))])
    for (const s of snaps) {
      if (!s.exists()) throw new EntregaYaIncluidaError(s.id)
      if (s.data().entregaId !== null) throw new EntregaYaIncluidaError((s.data().codigo as string | undefined) ?? s.id)
    }
    const numero = counterSnap.exists() ? (counterSnap.data().next as number) : 1
    const id = entregaId(datos.fecha, datos.plantaId, numero)
    tx.set(COUNTER_REF(datos.plantaId), { next: numero + 1 })
    const entrega: Omit<EntregaTesoreria, 'id'> = {
      ...datos, numero, codigo: codigoEntrega(datos.plantaId, numero),
      estado: 'entregada', destino: 'tesoreria', entregadoPor: actor, createdAt: Timestamp.now(), recibidoPor: null,
    }
    tx.set(doc(db, ENTREGAS, id), entrega)
    for (const r of [...liqRefs, ...rendRefs]) tx.update(r, { entregaId: id })
    return { id, ...entrega }
  })
}

export type ConfirmacionEntrega = Pick<EntregaTesoreria, 'firmaRecibe' | 'firmanteRecibe' | 'efectivoContado' | 'diferenciaEfectivo' | 'cheques' | 'retenciones' | 'valoresFaltantes'> & { diferencia?: EntregaTesoreria['diferencia'] }

/** Tesorería contó y tildó: pasa a confirmada (una sola vez). */
export const confirmarEntrega = (id: string, datos: ConfirmacionEntrega, actor: { uid: string; nombre: string }): Promise<void> =>
  updateDoc(doc(db, ENTREGAS, id), {
    ...datos, estado: 'confirmada', recibidoPor: actor, confirmadaEn: Timestamp.now(),
  })

const aEntrega = (d: { id: string; data: () => unknown }) => ({ id: d.id, ...(d.data() as object) }) as EntregaTesoreria

export const subscribeEntregasEnRango = (desde: string, hasta: string, callback: (entregas: EntregaTesoreria[]) => void): () => void =>
  onSnapshot(
    query(collection(db, ENTREGAS), where('fecha', '>=', desde), where('fecha', '<', hasta)),
    (snap) => callback(snap.docs.map(aEntrega)),
    (err) => { reportError(err, { subscription: 'entregasTesoreria-rango', desde, hasta }); callback([]) },
  )

export const subscribeEntregasPorConfirmar = (callback: (entregas: EntregaTesoreria[]) => void): () => void =>
  onSnapshot(
    query(collection(db, ENTREGAS), where('estado', '==', 'entregada')),
    (snap) => callback(snap.docs.map(aEntrega)),
    (err) => { reportError(err, { subscription: 'entregasTesoreria-pendientes' }); callback([]) },
  )

export async function getEntrega(id: string): Promise<EntregaTesoreria | null> {
  const s = await getDoc(doc(db, ENTREGAS, id))
  return s.exists() ? aEntrega(s) : null
}
