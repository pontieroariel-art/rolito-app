import {
  collection, doc, onSnapshot, query, runTransaction, updateDoc, where, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import { RemitoCarga, RemitoCargaItem, PlantaId } from '../types'
import { PLANTA_INFO } from '../utils/constants'

const REMITOS = 'remitosCarga'

// Contador correlativo por planta (config/cargaCounter_torcuato / _merlo) —
// mismo patrón transaccional que produccionCounterService, pero SIN reserva de
// lotes offline ni inicialización manual: caja opera desde una PC con red, y
// la serie RC- arranca en 1 (numeración nueva de la app, no continúa la del
// sistema viejo).
const COUNTER_REF = (plantaId: PlantaId) => doc(db, 'config', `cargaCounter_${plantaId}`)

export const codigoRemitoCarga = (plantaId: PlantaId, numero: number): string =>
  `RC-${PLANTA_INFO[plantaId].prefijoCodigo}-${String(numero).padStart(6, '0')}`

export interface ActorCaja { uid: string; nombre: string; plantaId: PlantaId }

// palletsInfo vive en utils/helpers (función pura, testeable sin Firebase). Se
// reexporta acá porque la pantalla de caja la importa desde este service.
export { palletsInfo, type PalletsInfo } from '../utils/helpers'

export interface CrearRemitoCargaArgs {
  camionId:     string
  camionLabel:  string
  choferId:     string
  choferNombre: string
  items:        RemitoCargaItem[]
  palletsCarga: number
}

// Crea el remito con su número correlativo en una sola transacción (el
// contador se crea solo en el primer uso de cada planta). A diferencia de la
// venta del chofer esto SÍ espera al servidor: caja necesita el número
// definitivo para imprimir, y está en una PC con conexión.
export async function crearRemitoCarga(args: CrearRemitoCargaArgs, actor: ActorCaja): Promise<RemitoCarga> {
  const remitoRef = doc(collection(db, REMITOS))
  const data = await runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(COUNTER_REF(actor.plantaId))
    const numero = counterSnap.exists() ? (counterSnap.data().next as number) : 1
    tx.set(COUNTER_REF(actor.plantaId), { next: numero + 1 })

    const remito: Omit<RemitoCarga, 'id'> = {
      numero,
      codigo:       codigoRemitoCarga(actor.plantaId, numero),
      plantaId:     actor.plantaId,
      camionId:     args.camionId,
      camionLabel:  args.camionLabel,
      choferId:     args.choferId,
      choferNombre: args.choferNombre,
      items:        args.items,
      palletsCarga: args.palletsCarga,
      estado:       'emitido',
      creadoPor:    { uid: actor.uid, nombre: actor.nombre },
      fecha:        Timestamp.now(),
      tango:        { estado: 'pendiente' },
    }
    tx.set(remitoRef, remito)
    return remito
  })
  return { id: remitoRef.id, ...data }
}

// Muelle asigna (o cambia) la dársena donde carga el camión — el tablero de
// TV agrupa por este campo. Solo mientras el remito sigue 'emitido'.
export const asignarDarsena = (
  remito: RemitoCarga,
  darsena: number,
): Promise<void> =>
  updateDoc(doc(db, REMITOS, remito.id), { darsena })

// Seguridad controla el camión cargado en el portón y libera la salida.
// Solo la transición entregado → salido — reglas con hasOnly.
export const marcarSalidaRemito = (
  remito: RemitoCarga,
  actor: { uid: string; nombre: string },
): Promise<void> =>
  updateDoc(doc(db, REMITOS, remito.id), {
    estado: 'salido',
    salida: { uid: actor.uid, nombre: actor.nombre, hora: Timestamp.now() },
  })

const rangoDia = (dia: Date): [Timestamp, Timestamp] => {
  const desde = new Date(dia); desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
  return [Timestamp.fromDate(desde), Timestamp.fromDate(hasta)]
}

// Remitos del día de una planta (listado de la pantalla de caja).
export const subscribeRemitosCargaDelDia = (
  plantaId: PlantaId,
  dia: Date,
  callback: (remitos: RemitoCarga[]) => void,
): () => void => {
  const [desde, hasta] = rangoDia(dia)
  return onSnapshot(
    query(
      collection(db, REMITOS),
      where('plantaId', '==', plantaId),
      where('fecha', '>=', desde),
      where('fecha', '<', hasta),
    ),
    (snap) => callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as RemitoCarga))
        .sort((a, b) => b.numero - a.numero),
    ),
    onSnapshotError(callback, 'remitosCarga'),
  )
}

// Remitos de carga de HOY de un chofer ("Mi carga de hoy" en su hub; además es
// la fuente del camión del día — users/{uid}.camionId no lo escribe ninguna UI).
export const subscribeRemitosCargaChoferHoy = (
  choferId: string,
  callback: (remitos: RemitoCarga[]) => void,
): () => void => {
  const [desde, hasta] = rangoDia(new Date())
  return onSnapshot(
    query(
      collection(db, REMITOS),
      where('choferId', '==', choferId),
      where('fecha', '>=', desde),
      where('fecha', '<', hasta),
    ),
    (snap) => callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as RemitoCarga))
        .sort((a, b) => b.numero - a.numero),
    ),
    onSnapshotError(callback, 'remitosCarga'),
  )
}
