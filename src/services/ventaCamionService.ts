import { collection, doc, getDoc, onSnapshot, query, where, orderBy, limit, setDoc, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { VentaCamion, VentaCamionItem, FormaPago, CanalVenta, UserProfile } from '../types'

const VENTAS = 'ventasCamion'

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
    ...(args.cliente.codigoTango   ? { clienteCodigoTango:  args.cliente.codigoTango } : {}),
    ...(args.cliente.idGva14Tango != null ? { clienteIdGva14Tango: args.cliente.idGva14Tango } : {}),
    ...(args.firmaCliente   ? { firmaCliente: args.firmaCliente } : {}),
    ...(args.firmanteNombre ? { firmanteNombre: args.firmanteNombre.trim() } : {}),
  }

  setDoc(ref, venta)   // fire-and-forget, se sincroniza solo al reconectar
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
    () => callback([]),
  )

// Últimas ventas del chofer (para el resumen de su pantalla).
export const subscribeVentasRecientesChofer = (
  choferId: string,
  callback: (ventas: VentaCamion[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, VENTAS), where('choferId', '==', choferId), orderBy('fecha', 'desc'), limit(50)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as VentaCamion))),
    () => callback([]),
  )
