import {
  collection, doc, onSnapshot, query, setDoc, updateDoc, where, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import { DescargaCamion, DescargaCamionItem, PlantaId, RemitoCarga } from '../types'

const DESCARGAS = 'descargasCamion'

export interface ActorMuelle { uid: string; nombre: string; plantaId: PlantaId }

// Muelle registra el conteo físico de lo que bajó del camión al volver. Una
// descarga por retorno (dos vueltas = dos descargas); la liquidación agrega
// todas las del chofer en el día. Espera al servidor: muelle opera con la
// tablet en la planta (con red) y el conteo es el número que define las
// diferencias — mejor enterarse en el momento si no se guardó.
export async function crearDescargaCamion(
  args: {
    camionId:         string
    camionLabel:      string
    choferId:         string
    choferNombre:     string
    items:            DescargaCamionItem[]
    bolsasRotas:      DescargaCamionItem[]
    palletsCompletos: number
    palletsParciales: number
    palletsVacios:    number
  },
  actor: ActorMuelle,
): Promise<DescargaCamion> {
  const ref = doc(collection(db, DESCARGAS))
  const descarga: Omit<DescargaCamion, 'id'> = {
    plantaId:      actor.plantaId,
    ...args,
    registradoPor: { uid: actor.uid, nombre: actor.nombre },
    fecha:         Timestamp.now(),
  }
  await setDoc(ref, descarga)
  return { id: ref.id, ...descarga }
}

// Muelle confirma que entregó la mercadería de un remito de carga (el camión
// se cargó contra el papel). Solo toca estado + entregadoPor — reglas con
// hasOnly, el resto del remito es inmutable.
export const confirmarEntregaRemito = (
  remito: RemitoCarga,
  actor: ActorMuelle,
): Promise<void> =>
  updateDoc(doc(db, 'remitosCarga', remito.id), {
    estado:       'entregado',
    entregadoPor: { uid: actor.uid, nombre: actor.nombre, hora: Timestamp.now() },
  })

const rangoDia = (dia: Date): [Timestamp, Timestamp] => {
  const desde = new Date(dia); desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
  return [Timestamp.fromDate(desde), Timestamp.fromDate(hasta)]
}

// Descargas del día de una planta (pantalla de muelle).
export const subscribeDescargasDelDia = (
  plantaId: PlantaId,
  dia: Date,
  callback: (descargas: DescargaCamion[]) => void,
): () => void => {
  const [desde, hasta] = rangoDia(dia)
  return onSnapshot(
    query(
      collection(db, DESCARGAS),
      where('plantaId', '==', plantaId),
      where('fecha', '>=', desde),
      where('fecha', '<', hasta),
    ),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DescargaCamion))),
    onSnapshotError(callback, 'descargasCamion'),
  )
}

// Descargas de un chofer en un rango (para la liquidación).
export const subscribeDescargasChoferEnRango = (
  choferId: string,
  desde: Date, hasta: Date,
  callback: (descargas: DescargaCamion[]) => void,
): () => void =>
  onSnapshot(
    query(
      collection(db, DESCARGAS),
      where('choferId', '==', choferId),
      where('fecha', '>=', Timestamp.fromDate(desde)),
      where('fecha', '<', Timestamp.fromDate(hasta)),
    ),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DescargaCamion))),
    onSnapshotError(callback, 'descargasCamion'),
  )
