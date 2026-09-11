import { collection, doc, onSnapshot, query, setDoc, updateDoc, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { toDateStr } from '../utils/helpers'
import type { AnulacionVentanilla, MotivoAnulacion, PlantaId, VentaCamion, VentaVentanilla } from '../types'

// Anulación de facturas con nota de crédito (2026-09-09; camión 2026-09-11).
// El cajero crea la solicitud (id = id de la venta: una por venta); quien
// tiene `users.autorizaAnulaciones` la aprueba o rechaza; el server emite la
// NC en ARCA y refleja el resultado (ver functions/triggers/anulacionesVentanilla).
// La factura del camión la pide el cajero desde la liquidación abierta del
// chofer: la solicitud lleva `coleccion: 'ventasCamion'` y el chofer.

const ANULACIONES = 'anulacionesVentanilla'

export type VentaAnulable =
  | { coleccion: 'ventasVentanilla'; venta: VentaVentanilla }
  | { coleccion: 'ventasCamion'; venta: VentaCamion; plantaId: PlantaId }

/** El cajero pide anular la factura de una venta (la suya en ventanilla; la del chofer que liquida). Falla si no hay factura emitida. */
export async function solicitarAnulacion(
  objetivo: VentaAnulable,
  motivo: MotivoAnulacion,
  nota: string,
  actor: { uid: string; nombre: string },
): Promise<void> {
  const { venta } = objetivo
  const f = venta.factura
  const ci = venta.comprobanteInterno
  // Promo (factura X, sin ARCA): la NC es interna y la numera el server (2026-09-11).
  const esPromoX = venta.canal === 'promo' && ci?.tipo === 'facturaX' && (ci.numero ?? 0) > 0
  if (!esPromoX && (!f || f.estado !== 'emitida' || !f.cae)) throw new Error('Esta venta no tiene una factura emitida para anular.')
  const facturaOriginal = esPromoX && ci
    ? { cbteTipo: 0, puntoVenta: ci.puntoVenta, numero: ci.numero, cae: null, total: venta.total }
    : { cbteTipo: f!.cbteTipo, puntoVenta: f!.puntoVenta, numero: f!.numero, cae: f!.cae, total: f!.importes?.total ?? venta.total }
  const data: Omit<AnulacionVentanilla, 'id'> = {
    ventaId: venta.id,
    coleccion: objetivo.coleccion,
    plantaId: objetivo.coleccion === 'ventasVentanilla' ? objetivo.venta.plantaId : objetivo.plantaId,
    cajaId: actor.uid,
    cajaNombre: actor.nombre,
    ...(objetivo.coleccion === 'ventasCamion' ? { choferId: objetivo.venta.choferId, choferNombre: objetivo.venta.choferNombre } : {}),
    clienteNombre: venta.clienteNombre,
    fechaVenta: toDateStr(venta.fecha.toDate()),
    facturaOriginal,
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
