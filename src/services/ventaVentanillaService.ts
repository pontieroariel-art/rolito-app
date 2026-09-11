import {
  collection, doc, getDoc, onSnapshot, query, runTransaction, setDoc, updateDoc, where, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError, esperarOEncolar, reportError } from './observability'
import { todayString } from '../utils/helpers'
import { tipoComprobanteInterno } from '../utils/comprobanteInterno'
import {
  CanalVenta, ComprobanteInternoVenta, FormaPago, PlantaId, TipoComprobanteInterno, VentaCamionItem, VentaVentanilla,
} from '../types'

const VENTAS = 'ventasVentanilla'

/** Una venta por id (para reimprimir su nota de crédito desde la bandeja de anulaciones). */
export async function getVentaVentanilla(id: string): Promise<VentaVentanilla | null> {
  const s = await getDoc(doc(db, VENTAS, id))
  return s.exists() ? ({ id: s.id, ...s.data() } as VentaVentanilla) : null
}

export interface ActorCajaVentanilla { uid: string; nombre: string; plantaId: PlantaId }

// Contador de turnos de ventanilla: correlativo por planta que se RESETEA
// cada día (el turno es "número del día", como el de la fiambrería — doc
// config/turnoVentanilla_{plantaId} con { fecha, next }).
const TURNO_REF = (plantaId: PlantaId) => doc(db, 'config', `turnoVentanilla_${plantaId}`)
// Mismas series de comprobantes internos que el camión (numeracionInternaService):
// config/numeracionInterna_{remito|facturaX} = { next, puntoVenta, ultimo? }.
const COUNTER_REF = (tipo: TipoComprobanteInterno) => doc(db, 'config', `numeracionInterna_${tipo}`)

// Venta en el mostrador de la planta. Espera al servidor (caja está en una PC
// con red y el comprobante que se imprime debe corresponder a un doc ya
// persistido). La transacción toma el turno del día y crea la venta juntos.
// Cliente registrado y ocasional son excluyentes — la construcción
// condicional evita campos undefined (Firestore los rechaza).
export async function crearVentaVentanilla(
  args: {
    canal:      CanalVenta
    cliente?:   { uid: string; nombre: string; codigoTango?: string; idGva14Tango?: number; sucursalNombre?: string }
    /** Orden de compra del cliente registrado (opcional). */
    ordenCompra?: string
    ocasional?: { nombre: string; cuit?: string; dni?: string }
    items:      VentaCamionItem[]
    formaPago:  FormaPago
  },
  actor: ActorCajaVentanilla,
): Promise<VentaVentanilla> {
  const ref   = doc(collection(db, VENTAS))
  const total = args.items.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0)
  const hoy   = todayString()

  // El comprobante interno que NO autoriza ARCA sale numerado acá mismo desde
  // el contador compartido con el camión (caja está online: no hace falta
  // reserva local): la promo (Rolito) como factura X y la cuenta corriente
  // (Redonhielo) como remito. Sin número Tango no tiene qué registrar (pasó
  // el 2026-09-07 con la factura X y el 2026-09-09 con el remito). Si el
  // contador no está inicializado o el talonario se agotó, la venta sale
  // igual, sin número.
  const tipoInterno = tipoComprobanteInterno({ canal: args.canal, formaPago: args.formaPago, total })

  const venta = await runTransaction(db, async (tx) => {
    const turnoSnap = await tx.get(TURNO_REF(actor.plantaId))
    const contadorSnap = tipoInterno ? await tx.get(COUNTER_REF(tipoInterno)) : null
    const turno = (turnoSnap.exists() && turnoSnap.data().fecha === hoy)
      ? (turnoSnap.data().next as number)
      : 1
    tx.set(TURNO_REF(actor.plantaId), { fecha: hoy, next: turno + 1 })

    let comprobanteInterno: ComprobanteInternoVenta | undefined
    if (tipoInterno && contadorSnap?.exists()) {
      const c = contadorSnap.data()
      const next = c.next as number
      const puntoVenta = Number(c.puntoVenta)
      // Último número habilitado del talonario (remito con CAI); sin él la serie es infinita.
      const ultimo = c.ultimo == null ? null : Number(c.ultimo)
      if (Number.isInteger(next) && Number.isInteger(puntoVenta) && puntoVenta >= 1 && (ultimo === null || next <= ultimo)) {
        comprobanteInterno = { tipo: tipoInterno, puntoVenta, numero: next }
        tx.update(COUNTER_REF(tipoInterno), { next: next + 1 })
      }
    }

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
      ...(args.cliente?.sucursalNombre ? { clienteSucursalNombre: args.cliente.sucursalNombre } : {}),
      ...(args.cliente && args.ordenCompra?.trim() ? { ordenCompra: args.ordenCompra.trim().slice(0, 40) } : {}),
      ...(args.ocasional ? { clienteOcasional: args.ocasional } : {}),
      ...(comprobanteInterno ? { comprobanteInterno } : {}),
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
export const confirmarEntregaVentanilla = async (
  venta: VentaVentanilla,
  actor: { uid: string; nombre: string },
): Promise<void> => {
  await esperarOEncolar(
    updateDoc(doc(db, VENTAS, venta.id), {
      estado:       'entregado',
      entregadoPor: { uid: actor.uid, nombre: actor.nombre, hora: Timestamp.now() },
    }),
    { origen: 'confirmarEntregaVentanilla', ventaId: venta.id },
  )
}

// Seguridad marca en el portón que la mercadería de ventanilla salió de la
// planta (terceros que retiran con vehículo). Solo estampa `salida`.
export const marcarSalidaVentanilla = async (
  venta: VentaVentanilla,
  actor: { uid: string; nombre: string },
): Promise<void> => {
  await esperarOEncolar(
    updateDoc(doc(db, VENTAS, venta.id), {
      salida: { uid: actor.uid, nombre: actor.nombre, hora: Timestamp.now() },
    }),
    { origen: 'marcarSalidaVentanilla', ventaId: venta.id },
  )
}

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
    onSnapshotError(callback, 'ventasVentanilla'),
  )
}

// Ventas de UN usuario de caja en un rango (su "Mi día" y su cierre de caja,
// 2026-09-09). Índice (cajaId, fecha). Sin orden en la query: se ordena acá.
export const subscribeVentasVentanillaDeUsuarioEnRango = (
  cajaId: string,
  desde: Date, hasta: Date,
  callback: (ventas: VentaVentanilla[]) => void,
): () => void =>
  onSnapshot(
    query(
      collection(db, VENTAS),
      where('cajaId', '==', cajaId),
      where('fecha', '>=', Timestamp.fromDate(desde)),
      where('fecha', '<', Timestamp.fromDate(hasta)),
    ),
    (snap) => callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as VentaVentanilla))
        .sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()),
    ),
    onSnapshotError(callback, 'ventasVentanilla'),
  )

// Una venta puntual, en vivo: caja espera acá a que el trigger de ARCA escriba
// `factura` para imprimir el comprobante fiscal (decisión 2026-09-03: en el
// mostrador no se imprime nada hasta tener el CAE).
export const subscribeVentaVentanilla = (
  id: string,
  callback: (venta: VentaVentanilla | null) => void,
): () => void =>
  onSnapshot(
    doc(db, VENTAS, id),
    (snap) => callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as VentaVentanilla) : null),
    (err) => { reportError(err, { subscription: 'ventasVentanilla', id }); callback(null) },
  )
