import { collection, doc, getDoc, onSnapshot, query, where, orderBy, limit, setDoc, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { fireAndForget, onSnapshotError } from './observability'
import { VentaCamion, VentaCamionItem, FormaPago, CanalVenta, UserProfile } from '../types'

const VENTAS = 'ventasCamion'

// `camionId` puede venir vacío: el que va de acompañante no tiene remito de
// carga propio, y un chofer sin camión asignado igual sale a vender. La venta
// queda sin camión (fuera del stock en vivo de ese camión) pero sigue contando
// para la liquidación, que es por repartidor.
export interface ActorChofer { uid: string; nombre: string; camionId: string }

// Cliente mínimo necesario para armar el remito de la venta.
export type ClienteVenta = Pick<UserProfile, 'uid' | 'razonSocial' | 'nombre' | 'codigoTango' | 'idGva14Tango'>

// Crea una venta desde el camión. Offline-first, mismo criterio que crearPallet
// (produccionService): se arma el doc y se hace setDoc fire-and-forget, que
// queda encolado por persistentLocalCache si no hay red — el chofer no espera
// ningún await. El número de remito lo asigna Tango después (async) y vuelve al
// doc vía la Cloud Function onOutboxConfirmado.
export function crearVentaCamion(
  args: {
    canal:     CanalVenta
    cliente:   ClienteVenta
    items:     VentaCamionItem[]
    /** Renglones de cambio, en $0. Van aparte de `items` para que no haya
     *  forma de que se cuelen en el total ni en lo que se declara a ARCA. */
    cambios?:  VentaCamionItem[]
    formaPago: FormaPago
    firmaCliente?:   string
    firmanteNombre?: string
    pedidoId?: string | null
  },
  actor: ActorChofer,
): VentaCamion {
  const ref   = doc(collection(db, VENTAS))
  const fecha = Timestamp.now()
  const total = args.items.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0)

  // Construcción condicional: Firestore rechaza campos `undefined`, así que los
  // opcionales solo se incluyen si tienen valor.
  const venta: Omit<VentaCamion, 'id'> = {
    canal:         args.canal,
    camionId:      actor.camionId,
    choferId:      actor.uid,
    choferNombre:  actor.nombre,
    clienteId:     args.cliente.uid,
    clienteNombre: args.cliente.razonSocial || args.cliente.nombre,
    items:         args.items,
    total,
    formaPago:     args.formaPago,
    fecha,
    pedidoId:      args.pedidoId ?? null,
    tango:         { estado: 'pendiente' },
    ...(args.cambios?.length ? { cambios: args.cambios } : {}),
    ...(args.cliente.codigoTango   ? { clienteCodigoTango:  args.cliente.codigoTango } : {}),
    ...(args.cliente.idGva14Tango != null ? { clienteIdGva14Tango: args.cliente.idGva14Tango } : {}),
    ...(args.firmaCliente   ? { firmaCliente: args.firmaCliente } : {}),
    ...(args.firmanteNombre ? { firmanteNombre: args.firmanteNombre.trim() } : {}),
  }

  // fire-and-forget (offline-first); el .catch reporta un rechazo del servidor
  // en vez de perderlo en silencio tras haber dicho "registrado".
  fireAndForget(setDoc(ref, venta), { origen: 'crearVentaCamion', ventaId: ref.id, choferId: actor.uid })
  return { id: ref.id, ...venta }
}

export const getVentaCamion = async (id: string): Promise<VentaCamion | null> => {
  const snap = await getDoc(doc(db, VENTAS, id))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as VentaCamion) : null
}

// Ventas de un camión en un rango (para el stock en vivo y la liquidación).
// Sin limit(): el rango de fecha ya acota el resultado (mismo criterio que
// subscribePalletsEnRango).
export const subscribeVentasCamionEnRango = (
  camionId: string,
  desde: Date, hasta: Date,
  callback: (ventas: VentaCamion[]) => void,
): () => void =>
  onSnapshot(
    query(
      collection(db, VENTAS),
      where('camionId', '==', camionId),
      where('fecha', '>=', Timestamp.fromDate(desde)),
      where('fecha', '<',  Timestamp.fromDate(hasta)),
    ),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as VentaCamion))),
    onSnapshotError(callback, 'ventasCamion'),
  )

// Ventas de un chofer en un rango (para la liquidación del día — la hoja
// vieja liquida por repartidor, no por camión).
export const subscribeVentasChoferEnRango = (
  choferId: string,
  desde: Date, hasta: Date,
  callback: (ventas: VentaCamion[]) => void,
): () => void =>
  onSnapshot(
    query(
      collection(db, VENTAS),
      where('choferId', '==', choferId),
      where('fecha', '>=', Timestamp.fromDate(desde)),
      where('fecha', '<', Timestamp.fromDate(hasta)),
    ),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as VentaCamion))),
    onSnapshotError(callback, 'ventasCamion'),
  )

// Últimas ventas del chofer (para el resumen de su pantalla).
export const subscribeVentasRecientesChofer = (
  choferId: string,
  callback: (ventas: VentaCamion[]) => void,
  // La pantalla necesita distinguir "no hay ventas" de "no las pude leer": con
  // una factura ya emitida, decir que no hay ninguna es peor que no decir nada.
  alFallar?: (err: Error) => void,
  // Cuántas de estas ventas siguen solo en el teléfono (escritas offline y
  // todavía no confirmadas por el servidor). Caja no las ve hasta que suban:
  // si el chofer rinde antes, la liquidación sale sin ellas. Con este callback
  // la pantalla puede avisarle que espere.
  onPendientes?: (cantidad: number) => void,
): () => void =>
  onSnapshot(
    query(collection(db, VENTAS), where('choferId', '==', choferId), orderBy('fecha', 'desc'), limit(50)),
    { includeMetadataChanges: !!onPendientes },
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as VentaCamion)))
      onPendientes?.(snap.docs.filter((d) => d.metadata.hasPendingWrites).length)
    },
    onSnapshotError(callback, 'ventasCamion', alFallar),
  )
