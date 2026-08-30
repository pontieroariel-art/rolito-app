import { collection, doc, getDoc, getDocs, onSnapshot, query, where, orderBy, limit, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { PalletProduccion, PlantaId, ProductoHieloId } from '../types'
import { PLANTA_INFO } from '../utils/constants'
import { PRODUCTOS_HIELO } from '../utils/produccionCatalogo'
import { consumirNumero, precargarSiSeAcerca } from './produccionReservaService'
import { fireAndForget } from './observability'

const PALLETS = 'produccionPallets'

export interface ActorProduccion { uid: string; nombre: string }

// NO es una transacción Firestore, a propósito: el número ya salió de la
// reserva local (síncrono, produccionReservaService.ts). Acá solo se arma el
// documento y se hace setDoc, que queda encolado por persistentLocalCache si
// no hay red — no hay ningún await bloqueante antes de poder imprimir.
export function crearPallet(
  data:    { plantaId: PlantaId; productoId: ProductoHieloId },
  actor:   ActorProduccion,
  online:  boolean,
): { pallet: PalletProduccion; codigo: string } {
  const numero    = consumirNumero(actor.uid, data.plantaId)
  const prefijo   = PLANTA_INFO[data.plantaId].prefijoCodigo
  const codigo    = `${prefijo}-${String(numero).padStart(6, '0')}`
  const producto  = PRODUCTOS_HIELO[data.productoId]
  const palletRef = doc(collection(db, PALLETS))
  const fechaFabricacion = Timestamp.now()

  const pallet: Omit<PalletProduccion, 'id'> = {
    codigo,
    numero,
    plantaId:       data.plantaId,
    productoId:     data.productoId,
    productoNombre: producto.nombre,
    unidades:       producto.unidadesPorPallet,
    operador:       actor,
    fechaFabricacion,
    createdAt:      serverTimestamp() as unknown as Timestamp,
  }
  // fire-and-forget (offline-first); el .catch reporta un rechazo en vez de
  // perder el pallet en silencio.
  fireAndForget(setDoc(palletRef, pallet), { origen: 'crearPallet', palletId: palletRef.id, plantaId: data.plantaId })

  precargarSiSeAcerca(actor.uid, data.plantaId, online)

  return { pallet: { id: palletRef.id, ...pallet, fechaFabricacion }, codigo }
}

export const getPalletProduccion = async (id: string): Promise<PalletProduccion | null> => {
  const snap = await getDoc(doc(db, PALLETS, id))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as PalletProduccion) : null
}

// plantaId opcional: sin filtro para el listado de gerencia (todas las
// plantas), fijo a la propia planta para el dashboard del operario.
export const subscribePalletsRecientes = (
  plantaId: PlantaId | undefined,
  callback: (pallets: PalletProduccion[]) => void,
): () => void =>
  onSnapshot(
    plantaId
      ? query(collection(db, PALLETS), where('plantaId', '==', plantaId), orderBy('createdAt', 'desc'), limit(200))
      : query(collection(db, PALLETS), orderBy('createdAt', 'desc'), limit(500)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PalletProduccion))),
    () => callback([]),
  )

// Último pallet realmente cargado de una planta (para la pantalla de Plantas:
// el contador del servidor muestra dónde arranca el PRÓXIMO LOTE a reservar,
// no el próximo pallet — las tablets reservan lotes de a 30 y los consumen
// localmente, ver produccionReservaService). Mismo índice compuesto que
// subscribePalletsRecientes (plantaId + createdAt desc).
export const getUltimoPallet = async (plantaId: PlantaId): Promise<PalletProduccion | null> => {
  const snap = await getDocs(
    query(collection(db, PALLETS), where('plantaId', '==', plantaId), orderBy('createdAt', 'desc'), limit(1)),
  )
  const d = snap.docs[0]
  return d ? ({ id: d.id, ...d.data() } as PalletProduccion) : null
}

// Para sumar totales de un período (Resumen de Producción) — a diferencia de
// subscribePalletsRecientes, NO tiene limit(): un total que se corta en
// silencio por un límite artificial sería el mismo bug que se corrigió en
// subscribeKanbanOrders (pedidos agendados a futuro que desaparecían). Acá
// el rango ya viene acotado por fecha en las dos puntas, así que el
// resultado es naturalmente finito sin necesidad de limit().
export const subscribePalletsEnRango = (
  desde: Date, hasta: Date,
  callback: (pallets: PalletProduccion[]) => void,
): () => void =>
  onSnapshot(
    query(
      collection(db, PALLETS),
      where('fechaFabricacion', '>=', Timestamp.fromDate(desde)),
      where('fechaFabricacion', '<',  Timestamp.fromDate(hasta)),
    ),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PalletProduccion))),
    () => callback([]),
  )
