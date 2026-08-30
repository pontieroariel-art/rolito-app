import { collection, doc, onSnapshot, query, setDoc, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { fireAndForget } from './observability'
import { CambioCamion } from '../types'

const CAMBIOS = 'cambiosCamion'

// Cambio de producto defectuoso en la calle: el chofer entrega una bolsa nueva
// por una rota del cliente, sin venta ni plata. Offline-first, mismo criterio
// que crearVentaCamion: setDoc fire-and-forget, persistentLocalCache lo encola
// sin red — el chofer no espera.
export function crearCambioCamion(
  args: {
    clienteId:     string
    clienteNombre: string
    productoId:    string
    nombre:        string
    cantidad:      number
  },
  actor: { uid: string; nombre: string; camionId: string },
): CambioCamion {
  const ref = doc(collection(db, CAMBIOS))
  const cambio: Omit<CambioCamion, 'id'> = {
    camionId:      actor.camionId,
    choferId:      actor.uid,
    choferNombre:  actor.nombre,
    clienteId:     args.clienteId,
    clienteNombre: args.clienteNombre,
    productoId:    args.productoId,
    nombre:        args.nombre,
    cantidad:      args.cantidad,
    fecha:         Timestamp.now(),
  }
  // fire-and-forget (offline-first); el .catch reporta un rechazo en vez de
  // perder el cambio en silencio (cuadra contra las bolsas rotas en muelle).
  fireAndForget(setDoc(ref, cambio), { origen: 'crearCambioCamion', cambioId: ref.id, choferId: actor.uid })
  return { id: ref.id, ...cambio }
}

// Cambios de un chofer en un rango (para la liquidación y su propio resumen).
export const subscribeCambiosChoferEnRango = (
  choferId: string,
  desde: Date, hasta: Date,
  callback: (cambios: CambioCamion[]) => void,
): () => void =>
  onSnapshot(
    query(
      collection(db, CAMBIOS),
      where('choferId', '==', choferId),
      where('fecha', '>=', Timestamp.fromDate(desde)),
      where('fecha', '<', Timestamp.fromDate(hasta)),
    ),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CambioCamion))),
    () => callback([]),
  )
