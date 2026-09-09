import { collection, doc, onSnapshot, query, setDoc, updateDoc, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { toDateStr } from '../utils/helpers'
import type { AnulacionVentanilla, MotivoAnulacion, VentaVentanilla } from '../types'

// Anulación de facturas de ventanilla con nota de crédito (2026-09-09).
// El cajero crea la solicitud (id = id de la venta: una por venta); quien
// tiene `users.autorizaAnulaciones` la aprueba o rechaza; el server emite la
// NC en ARCA y refleja el resultado (ver functions/triggers/anulacionesVentanilla).

const ANULACIONES = 'anulacionesVentanilla'

/** El cajero pide anular la factura de SU venta. Falla si la venta no tiene factura emitida. */
export async function solicitarAnulacion(
  venta: VentaVentanilla,
  motivo: MotivoAnulacion,
  nota: string,
  actor: { uid: string; nombre: string },
): Promise<void> {
  const f = venta.factura
  if (!f || f.estado !== 'emitida' || !f.cae) throw new Error('Esta venta no tiene una factura emitida para anular.')
  const data: Omit<AnulacionVentanilla, 'id'> = {
    ventaId: venta.id,
    coleccion: 'ventasVentanilla',
    plantaId: venta.plantaId,
    cajaId: venta.cajaId,
    cajaNombre: venta.cajaNombre,
    clienteNombre: venta.clienteNombre,
    fechaVenta: toDateStr(venta.fecha.toDate()),
    facturaOriginal: { cbteTipo: f.cbteTipo, puntoVenta: f.puntoVenta, numero: f.numero, cae: f.cae, total: f.importes?.total ?? venta.total },
    items: venta.items.map((i) => ({ nombre: i.nombre, cantidad: i.cantidad, precioUnitario: i.precioUnitario })),
    total: venta.total,
    formaPago: venta.formaPago,
    motivo,
    nota: nota.trim(),
    estado: 'pendiente',
    solicitadoPor: actor,
    solicitadaEn: Timestamp.now(),
    resueltaPor: null,
  }
  await setDoc(doc(db, ANULACIONES, venta.id), data)
}

/** Aprueba o rechaza (solo esos campos: es lo que dejan las reglas). El rechazo exige nota. */
export const resolverAnulacion = (
  id: string,
  estado: 'aprobada' | 'rechazada',
  actor: { uid: string; nombre: string },
  notaResolucion: string,
): Promise<void> =>
  updateDoc(doc(db, ANULACIONES, id), {
    estado, resueltaPor: actor, resueltaEn: Timestamp.now(), notaResolucion: notaResolucion.trim(),
  })

const aAnulacion = (d: { id: string; data: () => unknown }) => ({ id: d.id, ...(d.data() as object) }) as AnulacionVentanilla

export const subscribeAnulacionesPendientes = (callback: (xs: AnulacionVentanilla[]) => void): () => void =>
  onSnapshot(
    query(collection(db, ANULACIONES), where('estado', '==', 'pendiente')),
    (snap) => callback(snap.docs.map(aAnulacion)),
    (err) => { reportError(err, { subscription: 'anulaciones-pendientes' }); callback([]) },
  )

/** Solicitudes cuya venta cae en [desde, hasta) (yyyy-MM-dd). Rango sobre un solo campo: sin índice. */
export const subscribeAnulacionesEnRango = (desde: string, hasta: string, callback: (xs: AnulacionVentanilla[]) => void): () => void =>
  onSnapshot(
    query(collection(db, ANULACIONES), where('fechaVenta', '>=', desde), where('fechaVenta', '<', hasta)),
    (snap) => callback(snap.docs.map(aAnulacion)),
    (err) => { reportError(err, { subscription: 'anulaciones-rango', desde, hasta }); callback([]) },
  )
