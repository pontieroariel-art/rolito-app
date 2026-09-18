import {
  collection, doc, onSnapshot, query, setDoc, updateDoc, where, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError, esperarOEncolar } from './observability'
import {
  DescargaCamion, DescargaCamionItem, EnvasesCarga, EnvasesDescarga, LiquidacionEnvases, PlantaId, RemitoCarga,
} from '../types'
import { claveDia } from '@/utils/diaReparto'

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
    depositoTango?:       string
    depositoTangoNombre?: string
    // Remito de carga del viaje (cuando hay: un fletero vuelve sin remito).
    remitoId?:        string
    remitoCodigo?:    string
    // Corrección de un conteo mal cargado (2026-09-13): reemplaza a esa
    // descarga y NO va a Tango (el stock lo ajusta la oficina a mano).
    rectificaA?:           string
    motivoRectificacion?:  string
    // Día del VIAJE ('yyyy-MM-dd', 2026-09-17): el del remito elegido aunque
    // se cuente al día siguiente. Sin remito, el día del conteo.
    diaReparto?:      string
    items:            DescargaCamionItem[]
    bolsasRotas:      DescargaCamionItem[]
    // Envases que volvieron, contados sueltos (desde 2026-09-07 reemplaza a
    // pallets completos / parciales / vacíos).
    envases:          EnvasesDescarga
    /**
     * Cuadre de envases contra el remito del viaje (2026-09-18). Hasta ahora la
     * tablet lo calculaba, se lo mostraba al muellero y lo tiraba: salidos
     * contra devueltos, por chofer y por viaje, es donde suele haber más plata
     * perdida que en los faltantes de producto. Sin remito no hay contra qué
     * cuadrar, así que es opcional.
     */
    envasesCuadre?:   LiquidacionEnvases
  },
  actor: ActorMuelle,
): Promise<DescargaCamion> {
  const ref = doc(collection(db, DESCARGAS))
  const {
    depositoTango, depositoTangoNombre, remitoId, remitoCodigo,
    rectificaA, motivoRectificacion, diaReparto, envasesCuadre, ...resto
  } = args
  const ahora = Timestamp.now()
  const descarga: Omit<DescargaCamion, 'id'> = {
    plantaId:      actor.plantaId,
    ...resto,
    ...(depositoTango ? { depositoTango, depositoTangoNombre: depositoTangoNombre ?? '' } : {}),
    ...(remitoId ? { remitoId, remitoCodigo: remitoCodigo ?? '' } : {}),
    ...(rectificaA ? { rectificaA, motivoRectificacion: motivoRectificacion ?? '' } : {}),
    ...(envasesCuadre ? { envasesCuadre } : {}),
    diaReparto:    diaReparto ?? claveDia(ahora),
    registradoPor: { uid: actor.uid, nombre: actor.nombre },
    fecha:         ahora,
    // Transferencia camión → planta en Tango, que encola onDescargaCamionCreada.
    tango:         { estado: 'pendiente' },
  }
  // Espera al servidor hasta 4 s; si el wifi se cayó, el doc ya quedó en el
  // cache local y se sube solo. Dejar el spinner para siempre termina peor:
  // muelle recarga, vuelve a cargar la descarga y la liquidación la cuenta
  // dos veces.
  await esperarOEncolar(setDoc(ref, descarga), { origen: 'crearDescargaCamion', descargaId: ref.id })
  return { id: ref.id, ...descarga }
}

// Muelle confirma que entregó la mercadería de un remito de carga (el camión
// se cargó contra el papel). Toca estado + entregadoPor y, si muelle corrige
// la composición de envases al cargar, `envases` + `palletsCarga` (reglas con
// hasOnly; el resto del remito es inmutable).
export const confirmarEntregaRemito = async (
  remito: RemitoCarga,
  actor: ActorMuelle,
  envases?: EnvasesCarga,
): Promise<void> => {
  await esperarOEncolar(
    updateDoc(doc(db, 'remitosCarga', remito.id), {
      estado:       'entregado',
      entregadoPor: { uid: actor.uid, nombre: actor.nombre, hora: Timestamp.now() },
      ...(envases ? { envases, palletsCarga: envases.tarimasMadera + envases.palletsMetal } : {}),
    }),
    { origen: 'confirmarEntregaRemito', remitoId: remito.id },
  )
}

// Firestore devuelve los docs sin orden garantizado cuando no hay orderBy, y
// la liquidación toma la ÚLTIMA descarga como hora de vuelta del camión
// (ResumenLiquidacion): sin esto podía mostrar la hora de la primera vuelta.
const porFecha = (ds: DescargaCamion[]): DescargaCamion[] =>
  [...ds].sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis())

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
    (snap) => callback(porFecha(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DescargaCamion)))),
    onSnapshotError(callback, 'descargasCamion'),
  )
}

// Descargas de un chofer en un rango (para la liquidación).
/**
 * Descargas de los VIAJES de un día de una planta (por `diaReparto`, 2026-09-17):
 * lo que miran los tableros en vivo. La tablet del muelle usa
 * subscribeDescargasDelDia (lo contado ese día físico).
 */
export const subscribeDescargasDeReparto = (
  plantaId: PlantaId,
  dia: Date,
  callback: (descargas: DescargaCamion[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, DESCARGAS), where('plantaId', '==', plantaId), where('diaReparto', '==', claveDia(dia))),
    (snap) => callback(porFecha(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DescargaCamion)))),
    onSnapshotError(callback, 'descargasCamion'),
  )

/** Descargas de los viajes de un chofer entre dos días (por `diaReparto`; `hasta` exclusivo). */
export const subscribeDescargasChoferEnRango = (
  choferId: string,
  desde: Date, hasta: Date,
  callback: (descargas: DescargaCamion[]) => void,
): () => void =>
  onSnapshot(
    query(
      collection(db, DESCARGAS),
      where('choferId', '==', choferId),
      where('diaReparto', '>=', claveDia(desde)),
      where('diaReparto', '<', claveDia(hasta)),
    ),
    (snap) => callback(porFecha(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DescargaCamion)))),
    onSnapshotError(callback, 'descargasCamion'),
  )

/**
 * Una descarga en vivo, por id (2026-09-18). La pantalla de cierre del muelle la
 * usa para mostrar el código `DC-DT-000012` en cuanto el servidor lo asigna: la
 * tablet guarda el conteo aunque no haya señal y no puede numerarlo ella, así
 * que el número aparece cuando el doc sincroniza y NUNCA se inventa uno
 * provisorio (con ese número el chofer rotula el sobre de la plata).
 */
export const subscribeDescarga = (
  id: string,
  callback: (descarga: DescargaCamion | null) => void,
): () => void =>
  onSnapshot(
    doc(db, DESCARGAS, id),
    (snap) => callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as DescargaCamion) : null),
    onSnapshotError(() => callback(null), 'descargasCamion'),
  )
