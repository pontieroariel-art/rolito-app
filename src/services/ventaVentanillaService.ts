import {
  collection, doc, onSnapshot, query, runTransaction, setDoc, updateDoc, where, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { todayString } from '../utils/helpers'
import {
  CanalVenta, FormaPago, PlantaId, VentaCamionItem, VentaVentanilla,
} from '../types'

const VENTAS = 'ventasVentanilla'

export interface ActorCajaVentanilla { uid: string; nombre: string; plantaId: PlantaId }

// Contador de turnos de ventanilla: correlativo por planta que se RESETEA
// cada día (el turno es "número del día", como el de la fiambrería — doc
// config/turnoVentanilla_{plantaId} con { fecha, next }).
const TURNO_REF = (plantaId: PlantaId) => doc(db, 'config', `turnoVentanilla_${plantaId}`)

// Venta en el mostrador de la planta. Espera al servidor (caja está en una PC
// con red y el comprobante que se imprime debe corresponder a un doc ya
// persistido). La transacción toma el turno del día y crea la venta juntos.
// Cliente registrado y ocasional son excluyentes — la construcción
// condicional evita campos undefined (Firestore los rechaza).
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
  const hoy   = todayString()

  const venta = await runTransaction(db, async (tx) => {
    const turnoSnap = await tx.get(TURNO_REF(actor.plantaId))
    const turno = (turnoSnap.exists() && turnoSnap.data().fecha === hoy)
      ? (turnoSnap.data().next as number)
      : 1
    tx.set(TURNO_REF(actor.plantaId), { fecha: hoy, next: turno + 1 })

    const data: Omit<VentaVentanilla, 'id'> = {
      plantaId:      actor.plantaId,
      canal:         args.canal,
      cajaId:        actor.uid,
      cajaNombre:    actor.nombre,
      clienteNombre: args.cliente?.nombre ?? args.ocasional?.nombre ?? '',
      items:         args.items,
      total,
      formaPago:     args.formaPago,
      estado:        'pendiente_entrega',
      turno,
      turnoEstado:   'en_espera',
      fecha:         Timestamp.now(),
      tango:         { estado: 'pendiente' },
      ...(args.cliente ? { clienteId: args.cliente.uid } : {}),
      ...(args.cliente?.codigoTango ? { clienteCodigoTango: args.cliente.codigoTango } : {}),
      ...(args.cliente?.idGva14Tango != null ? { clienteIdGva14Tango: args.cliente.idGva14Tango } : {}),
      ...(args.ocasional ? { clienteOcasional: args.ocasional } : {}),
    }
    tx.set(ref, data)
    return data
  })
  return { id: ref.id, ...venta }
}

// ── Acciones de la cola (muelle) ─────────────────────────────────────────────

// La mercadería del turno ya está juntada fuera de cámara, lista para cargar.
export const marcarTurnoPreparado = (venta: VentaVentanilla): Promise<void> =>
  updateDoc(doc(db, VENTAS, venta.id), { turnoEstado: 'preparado' })

// Llamar al turno a una dársena: el TV lo canta y la página pública avisa.
// También re-llama a un ausente que volvió.
export const llamarTurno = (venta: VentaVentanilla, darsena: number): Promise<void> =>
  updateDoc(doc(db, VENTAS, venta.id), {
    turnoEstado: 'llamado',
    darsena,
    llamadoAt: Timestamp.now(),
  })

// El cliente no se presentó: sale de la cola activa sin bloquear la dársena.
// La venta (ya pagada) sigue pendiente de entrega hasta que aparezca.
export const marcarTurnoAusente = (venta: VentaVentanilla): Promise<void> =>
  updateDoc(doc(db, VENTAS, venta.id), { turnoEstado: 'ausente' })

// Muelle confirma que entregó la mercadería de la ventanilla.
export const confirmarEntregaVentanilla = (
  venta: VentaVentanilla,
  actor: { uid: string; nombre: string },
): Promise<void> =>
  updateDoc(doc(db, VENTAS, venta.id), {
    estado:       'entregado',
    entregadoPor: { uid: actor.uid, nombre: actor.nombre, hora: Timestamp.now() },
  })

// Seguridad marca en el portón que la mercadería de ventanilla salió de la
// planta (terceros que retiran con vehículo). Solo estampa `salida`.
export const marcarSalidaVentanilla = (
  venta: VentaVentanilla,
  actor: { uid: string; nombre: string },
): Promise<void> =>
  updateDoc(doc(db, VENTAS, venta.id), {
    salida: { uid: actor.uid, nombre: actor.nombre, hora: Timestamp.now() },
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
