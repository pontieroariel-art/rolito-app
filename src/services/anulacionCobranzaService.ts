import { collection, doc, onSnapshot, query, setDoc, updateDoc, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { toDateStr } from '../utils/helpers'
import { formatoARS } from '../utils/money'
import type { AnulacionCobranza, Cobranza, MotivoAnulacionRecibo } from '../types'

// Anulación de un recibo de cobranza con autorización (2026-09-15, pedido de
// Ariel: "un botón de anulación en la rendición y que autoricen los autorizados").
// El que cobró crea la solicitud (id = id de la cobranza: una por recibo); quien
// tiene `users.autorizaAnulaciones` la aprueba o rechaza desde /anulaciones; el
// server marca la cobranza (`cobranzas.anulacion`, que el cliente no puede tocar)
// y avisa (ver functions/triggers/anulacionesCobranza).

const ANULACIONES = 'anulacionesCobranza'

/** Snapshot legible del recibo para la bandeja (quien autoriza no tiene que abrir la cobranza). */
export function resumenDelRecibo(c: Cobranza): AnulacionCobranza['resumen'] {
  const m = c.medios
  return {
    efectivo:      m?.efectivo ?? (c.formaPago === 'contado_efectivo' ? c.importe : 0),
    transferencia: m?.transferencia ?? (c.formaPago === 'contado_transferencia' ? c.importe : 0),
    cheques:       (m?.cheques ?? []).map((ch) => `${ch.numero} · ${ch.bancoNombre} · ${formatoARS(ch.importe)}`),
    retenciones:   (m?.retenciones ?? []).reduce((s, r) => s + r.importe, 0),
    facturas:      (c.imputaciones ?? []).map((i) => `${i.comprobanteTipo} ${i.comprobanteNumero} · ${formatoARS(i.importeImputado)}`),
    aCuenta:       c.aCuenta ?? 0,
  }
}

/** El que cobró pide anular SU recibo. Las reglas exigen que su día no esté cerrado. */
export async function solicitarAnulacionRecibo(
  c: Cobranza,
  motivo: MotivoAnulacionRecibo,
  nota: string,
  actor: { uid: string; nombre: string },
): Promise<void> {
  if (c.registradoPor.uid !== actor.uid) throw new Error('Solo podés anular un recibo que hiciste vos.')
  const data: Omit<AnulacionCobranza, 'id'> = {
    cobranzaId:     c.id,
    origen:         c.origen,
    ...(c.plantaId ? { plantaId: c.plantaId } : {}),
    cobradorId:     c.registradoPor.uid,
    cobradorNombre: c.registradoPor.nombre,
    clienteId:      c.clienteId,
    clienteNombre:  c.clienteNombre,
    ...(c.numeroRecibo ? { numeroRecibo: c.numeroRecibo } : {}),
    ...(c.tango?.reciboNumero ? { reciboTango: c.tango.reciboNumero } : {}),
    ...(c.empresa ? { empresa: c.empresa } : {}),
    ...(c.codigoTango ? { codigoTango: c.codigoTango } : {}),
    importe:        c.importe,
    resumen:        resumenDelRecibo(c),
    fechaCobranza:  toDateStr(c.fecha.toDate()),
    motivo,
    nota:           nota.trim(),
    estado:         'pendiente',
    solicitadoPor:  actor,
    solicitadaEn:   Timestamp.now(),
    resueltaPor:    null,
  }
  await setDoc(doc(db, ANULACIONES, c.id), data)
}

/** Aprueba o rechaza (solo esos campos: es lo que dejan las reglas). El rechazo exige nota. */
export const resolverAnulacionRecibo = (
  id: string,
  estado: 'aprobada' | 'rechazada',
  actor: { uid: string; nombre: string },
  notaResolucion: string,
): Promise<void> =>
  updateDoc(doc(db, ANULACIONES, id), {
    estado, resueltaPor: actor, resueltaEn: Timestamp.now(), notaResolucion: notaResolucion.trim(),
  })

const aAnulacion = (d: { id: string; data: () => unknown }) => ({ id: d.id, ...(d.data() as object) }) as AnulacionCobranza

export const subscribeAnulacionesReciboPendientes = (callback: (xs: AnulacionCobranza[]) => void): () => void =>
  onSnapshot(
    query(collection(db, ANULACIONES), where('estado', '==', 'pendiente')),
    (snap) => callback(snap.docs.map(aAnulacion)),
    (err) => { reportError(err, { subscription: 'anulaciones-recibo-pendientes' }); callback([]) },
  )

/** Solicitudes cuya cobranza cae en [desde, hasta) (yyyy-MM-dd). Rango sobre un solo campo: sin índice. */
export const subscribeAnulacionesReciboEnRango = (desde: string, hasta: string, callback: (xs: AnulacionCobranza[]) => void): () => void =>
  onSnapshot(
    query(collection(db, ANULACIONES), where('fechaCobranza', '>=', desde), where('fechaCobranza', '<', hasta)),
    (snap) => callback(snap.docs.map(aAnulacion)),
    (err) => { reportError(err, { subscription: 'anulaciones-recibo-rango', desde, hasta }); callback([]) },
  )
