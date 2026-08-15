import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  runTransaction,
  updateDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import { getPushSubscription } from './userService'
import { sendPush } from './notificationService'
import { TicketServicio } from '../types'

const TICKETS = 'ticketsServicio'
const HELADERAS = 'heladeras'
const COUNTER_REF = () => doc(db, 'config', 'ticketServicioCounter')

export interface Actor { uid: string; nombre: string }

export class TicketNoDisponibleError extends Error {}

function accion(actor: Actor, tipo: string, detalle?: string) {
  return {
    accion:        tipo,
    usuarioId:     actor.uid,
    usuarioNombre: actor.nombre,
    timestamp:     Timestamp.now(),
    detalle:       detalle ?? null,
  }
}

// ── Lecturas ─────────────────────────────────────────────────────────────────

export const subscribeTicketsRecientes = (
  callback: (tickets: TicketServicio[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, TICKETS), orderBy('createdAt', 'desc'), limit(300)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TicketServicio))),
    () => callback([]),
  )

export const subscribeTicketsPorHeladera = (
  heladeraId: string,
  callback: (tickets: TicketServicio[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, TICKETS), where('heladeraId', '==', heladeraId), orderBy('createdAt', 'desc'), limit(50)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TicketServicio))),
    () => callback([]),
  )

export const subscribeTicketsPorCliente = (
  clientId: string,
  callback: (tickets: TicketServicio[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, TICKETS), where('clientId', '==', clientId), orderBy('createdAt', 'desc'), limit(50)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TicketServicio))),
    () => callback([]),
  )

// Para técnico/chofer: solo sus propios tickets asignados (las reglas ya lo
// exigen, esta query solo evita traer de más).
export const subscribeTicketsAsignadosA = (
  uid: string,
  callback: (tickets: TicketServicio[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, TICKETS), where('asignadoA.uid', '==', uid), orderBy('createdAt', 'desc'), limit(100)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TicketServicio))),
    () => callback([]),
  )

// ── Escrituras ───────────────────────────────────────────────────────────────

export const crearTicket = (
  data: {
    heladeraId:     string
    heladeraCodigo: string
    clientId:       string
    clientName:     string
    motivoId:       string
    motivoNombre:   string
    requiereChofer: boolean
    urgente:        boolean
  },
  actor: Actor,
): Promise<TicketServicio> =>
  runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(COUNTER_REF())
    const numero = counterSnap.exists() ? (counterSnap.data().next as number) : 1
    tx.set(COUNTER_REF(), { next: numero + 1 })

    const fechaPedido = Timestamp.now()
    const ticketRef = doc(collection(db, TICKETS))
    const ticket: Omit<TicketServicio, 'id'> = {
      numero,
      heladeraId:     data.heladeraId,
      heladeraCodigo: data.heladeraCodigo,
      clientId:       data.clientId,
      clientName:     data.clientName,
      motivoId:       data.motivoId,
      motivoNombre:   data.motivoNombre,
      requiereChofer: data.requiereChofer,
      urgente:        data.urgente,
      estado:         'abierto',
      asignadoA:      null,
      historialAcciones: [accion(actor, 'creado', data.motivoNombre)],
      fechaPedido,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }
    tx.set(ticketRef, ticket)

    // Línea corta en el historial de la heladera — el detalle completo del
    // service vive en el propio ticket (sección "Tickets de service").
    tx.update(doc(db, HELADERAS, data.heladeraId), {
      historialAcciones: arrayUnion(accion(actor, 'service_abierto', data.motivoNombre)),
      updatedAt: serverTimestamp(),
    })

    return { id: ticketRef.id, ...ticket }
  })

async function notificarAsignacion(uid: string, titulo: string, cuerpo: string) {
  const subscription = await getPushSubscription(uid)
  if (subscription) await sendPush({ subscription, title: titulo, body: cuerpo })
}

export const asignarATecnico = (
  ticketId: string,
  tecnico:  { uid: string; nombre: string },
  actor:    Actor,
): Promise<void> =>
  runTransaction(db, async (tx) => {
    const ref  = doc(db, TICKETS, ticketId)
    const snap = await tx.get(ref)
    const data = snap.data() as TicketServicio | undefined
    if (!data || data.estado !== 'abierto') {
      throw new TicketNoDisponibleError('Este ticket ya fue asignado o no está abierto.')
    }
    tx.update(ref, {
      estado:    'asignado_tecnico',
      asignadoA: { tipo: 'tecnico', uid: tecnico.uid, nombre: tecnico.nombre },
      updatedAt: serverTimestamp(),
      historialAcciones: arrayUnion(accion(actor, 'asignado_tecnico', tecnico.nombre)),
    })
  }).then(() => {
    notificarAsignacion(tecnico.uid, 'Nuevo service asignado', 'Tenés un equipo para revisar.')
  })

export const asignarAChofer = (
  ticketId: string,
  chofer:   { uid: string; nombre: string },
  actor:    Actor,
): Promise<void> =>
  runTransaction(db, async (tx) => {
    const ref  = doc(db, TICKETS, ticketId)
    const snap = await tx.get(ref)
    const data = snap.data() as TicketServicio | undefined
    if (!data || data.estado !== 'abierto') {
      throw new TicketNoDisponibleError('Este ticket ya fue asignado o no está abierto.')
    }
    tx.update(ref, {
      estado:    'asignado_chofer',
      asignadoA: { tipo: 'chofer', uid: chofer.uid, nombre: chofer.nombre },
      updatedAt: serverTimestamp(),
      historialAcciones: arrayUnion(accion(actor, 'asignado_chofer', chofer.nombre)),
    })
  }).then(() => {
    notificarAsignacion(chofer.uid, 'Nuevo traslado de heladera', 'Tenés un retiro/entrega asignado.')
  })

// Baja confianza — técnico registra qué hizo, sin poder cambiar el estado
// del ticket (eso lo cierra el encargado desde Consulta de service).
export const registrarTrabajoTecnico = (
  ticketId: string,
  actor:    Actor,
  tipoReparacionId:     string,
  tipoReparacionNombre: string,
  detalle:  string,
): Promise<void> =>
  updateDoc(doc(db, TICKETS, ticketId), {
    tipoReparacionId,
    tipoReparacionNombre,
    trabajoRealizado: detalle,
    updatedAt: serverTimestamp(),
    historialAcciones: arrayUnion(accion(actor, 'trabajo_registrado', `${tipoReparacionNombre} — ${detalle}`)),
  })

// Baja confianza — chofer marca hecho el traslado, sin poder cambiar el estado.
export const marcarHechoChofer = (
  ticketId: string,
  actor:    Actor,
  detalle:  string,
): Promise<void> =>
  updateDoc(doc(db, TICKETS, ticketId), {
    trabajoRealizado: detalle,
    updatedAt: serverTimestamp(),
    historialAcciones: arrayUnion(accion(actor, 'trabajo_registrado', detalle)),
  })

export const cerrarTicket = (
  ticketId: string,
  actor:    Actor,
  firmaDataUrl: string,
  nombreQuienConfirma: string,
): Promise<void> =>
  updateDoc(doc(db, TICKETS, ticketId), {
    estado:     'cerrado',
    fechaCierre: serverTimestamp(),
    cerradoPor:  actor,
    conformidad: { firmaDataUrl, nombreQuienConfirma },
    updatedAt:   serverTimestamp(),
    historialAcciones: arrayUnion(accion(actor, 'cerrado', `Conformidad: ${nombreQuienConfirma}`)),
  })

export const anularTicket = (
  ticketId: string,
  actor:    Actor,
  motivo:   string,
): Promise<void> =>
  updateDoc(doc(db, TICKETS, ticketId), {
    estado:          'anulado',
    anuladoPor:      actor,
    motivoAnulacion: motivo,
    updatedAt:       serverTimestamp(),
    historialAcciones: arrayUnion(accion(actor, 'anulado', motivo)),
  })
