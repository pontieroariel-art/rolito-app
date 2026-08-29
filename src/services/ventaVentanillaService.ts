import {
  collection, doc, onSnapshot, query, setDoc, updateDoc, where, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import {
  CanalVenta, FormaPago, PlantaId, VentaCamionItem, VentaVentanilla,
} from '../types'

const VENTAS = 'ventasVentanilla'

export interface ActorCajaVentanilla { uid: string; nombre: string; plantaId: PlantaId }

// Venta en el mostrador de la planta. Espera al servidor (caja está en una PC
// con red y el comprobante que se imprime debe corresponder a un doc ya
// persistido). Cliente registrado y ocasional son excluyentes — la
// construcción condicional evita campos undefined (Firestore los rechaza).
export async function crearVentaVentanilla(
  args: {
    canal:      CanalVenta
    cliente?:   { uid: string; nombre: string; codigoTango?: string; idGva14Tango?: number }
    ocasional?: { nombre: string; cuit?: string }
    items:      VentaCamionItem[]
    formaPago:  FormaPago
  },
  actor: ActorCajaVentanilla,
): Promise<VentaVentanilla> {
  const ref   = doc(collection(db, VENTAS))
  const total = args.items.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0)

  const venta: Omit<VentaVentanilla, 'id'> = {
    plantaId:      actor.plantaId,
    canal:         args.canal,
    cajaId:        actor.uid,
    cajaNombre:    actor.nombre,
    clienteNombre: args.cliente?.nombre ?? args.ocasional?.nombre ?? '',
    items:         args.items,
    total,
    formaPago:     args.formaPago,
    estado:        'pendiente_entrega',
    fecha:         Timestamp.now(),
    tango:         { estado: 'pendiente' },
    ...(args.cliente ? { clienteId: args.cliente.uid } : {}),
    ...(args.cliente?.codigoTango ? { clienteCodigoTango: args.cliente.codigoTango } : {}),
    ...(args.cliente?.idGva14Tango != null ? { clienteIdGva14Tango: args.cliente.idGva14Tango } : {}),
    ...(args.ocasional ? { clienteOcasional: args.ocasional } : {}),
  }
  await setDoc(ref, venta)
  return { id: ref.id, ...venta }
}

// Muelle confirma que entregó la mercadería de la ventanilla.
export const confirmarEntregaVentanilla = (
  venta: VentaVentanilla,
  actor: { uid: string; nombre: string },
): Promise<void> =>
  updateDoc(doc(db, VENTAS, venta.id), {
    estado:       'entregado',
    entregadoPor: { uid: actor.uid, nombre: actor.nombre, hora: Timestamp.now() },
  })

// Ventas de ventanilla del día de una planta (pantallas de caja y muelle).
export const subscribeVentanillaDelDia = (
  plantaId: PlantaId,
  dia: Date,
  callback: (ventas: VentaVentanilla[]) => void,
): () => void => {
  const desde = new Date(dia); desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
  return onSnapshot(
    query(
      collection(db, VENTAS),
      where('plantaId', '==', plantaId),
      where('fecha', '>=', Timestamp.fromDate(desde)),
      where('fecha', '<', Timestamp.fromDate(hasta)),
    ),
    (snap) => callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as VentaVentanilla))
        .sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()),
    ),
    () => callback([]),
  )
}
