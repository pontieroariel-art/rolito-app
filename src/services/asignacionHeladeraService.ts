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
  deleteField,
  runTransaction,
} from 'firebase/firestore'
import { db } from './firebase'
import { AsignacionHeladera, Heladera, TipoOperacionIngreso } from '../types'
import { CatalogoPasos, primerPasoActivo } from '../utils/heladeraPipeline'
import { PipelineSinPasosError } from './heladeraService'

const HELADERAS   = 'heladeras'
const ASIGNACIONES = 'asignacionesHeladera'
const COUNTER_REF  = () => doc(db, 'config', 'movimientoHeladeraCounter')

export interface Actor { uid: string; nombre: string }

export class HeladeraNoAsignableError extends Error {}

function accion(actor: Actor, tipo: string, detalle?: string) {
  return {
    accion:        tipo,
    usuarioId:     actor.uid,
    usuarioNombre: actor.nombre,
    timestamp:     Timestamp.now(),
    detalle:       detalle ?? null,
  }
}

export const subscribeAsignacionesPorHeladera = (
  heladeraId: string,
  callback: (asignaciones: AsignacionHeladera[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, ASIGNACIONES), where('heladeraId', '==', heladeraId), orderBy('fecha', 'desc'), limit(50)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AsignacionHeladera))),
    () => callback([]),
  )

export const subscribeAsignacionesPorCliente = (
  clientId: string,
  callback: (asignaciones: AsignacionHeladera[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, ASIGNACIONES), where('clientId', '==', clientId), orderBy('fecha', 'desc'), limit(50)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AsignacionHeladera))),
    () => callback([]),
  )

// Asigna una heladera 'disponible' a un cliente: pasa a 'en_comodato', y
// registra el movimiento (remito + comodato) con firma. Transaccional para
// evitar que dos personas asignen la misma heladera a la vez.
export const asignarHeladera = (
  heladeraId:   string,
  cliente:      { id: string; nombre: string },
  actor:        Actor,
  firmaDataUrl: string,
): Promise<AsignacionHeladera> =>
  runTransaction(db, async (tx) => {
    const heladeraRef = doc(db, HELADERAS, heladeraId)
    const heladeraSnap = await tx.get(heladeraRef)
    const heladera = heladeraSnap.data() as Heladera | undefined
    if (!heladera || heladera.estado !== 'disponible') {
      throw new HeladeraNoAsignableError('Esta heladera no está disponible para asignar.')
    }

    const counterSnap = await tx.get(COUNTER_REF())
    const numero = (counterSnap.exists() ? (counterSnap.data().next as number) : 1)
    tx.set(COUNTER_REF(), { next: numero + 1 })

    const fecha = Timestamp.now()
    tx.update(heladeraRef, {
      estado:                'en_comodato',
      clienteAsignadoId:     cliente.id,
      clienteAsignadoNombre: cliente.nombre,
      fechaAsignacion:       fecha,
      updatedAt:             serverTimestamp(),
      historialAcciones:     arrayUnion(accion(actor, 'asignada', `A ${cliente.nombre}`)),
    })

    const asignacionRef = doc(collection(db, ASIGNACIONES))
    const asignacion: Omit<AsignacionHeladera, 'id'> = {
      heladeraId,
      heladeraCodigo: heladera.codigoInterno,
      clientId:       cliente.id,
      clientName:     cliente.nombre,
      tipo:           'asignacion',
      numero,
      firmaDataUrl,
      actor,
      fecha,
    }
    tx.set(asignacionRef, asignacion)
    return { id: asignacionRef.id, ...asignacion }
  })

// Retira una heladera 'en_comodato': entra al depósito del taller
// (pipeline de reacondicionamiento, primer paso) en vez de ir directo a
// 'disponible' — así el encargado la ve en /heladeras esperando el primer
// paso, como cualquier otro ingreso, sin tener que "cargarla de nuevo" a
// mano. Si resulta no necesitar arreglo, se libera desde ahí con
// liberarSinReacondicionar (heladeraService.ts).
export const retirarHeladera = (
  heladeraId:   string,
  actor:        Actor,
  firmaDataUrl: string,
  motivo:       { id: string; nombre: string; tipoOperacion: TipoOperacionIngreso },
  catalogo:     CatalogoPasos,
): Promise<AsignacionHeladera> => {
  const primerPaso = primerPasoActivo(catalogo, 'reacondicionamiento')
  if (!primerPaso) {
    throw new PipelineSinPasosError('Todavía no hay pasos configurados para reacondicionamiento — agregá uno primero en "Catálogos de service".')
  }
  return runTransaction(db, async (tx) => {
    const heladeraRef = doc(db, HELADERAS, heladeraId)
    const heladeraSnap = await tx.get(heladeraRef)
    const heladera = heladeraSnap.data() as Heladera | undefined
    if (!heladera || heladera.estado !== 'en_comodato' || !heladera.clienteAsignadoId) {
      throw new HeladeraNoAsignableError('Esta heladera no está asignada a ningún cliente.')
    }
    const clientId   = heladera.clienteAsignadoId
    const clientName = heladera.clienteAsignadoNombre ?? '—'

    const counterSnap = await tx.get(COUNTER_REF())
    const numero = (counterSnap.exists() ? (counterSnap.data().next as number) : 1)
    tx.set(COUNTER_REF(), { next: numero + 1 })

    const fecha = Timestamp.now()
    tx.update(heladeraRef, {
      estado:                'en_taller',
      tipoPipeline:           'reacondicionamiento',
      pasoActualId:           primerPaso.id,
      primerPasoId:           primerPaso.id,
      cicloActual:            (heladera.cicloActual ?? 1) + 1,
      motivoIngresoId:        motivo.id,
      motivoIngresoNombre:    motivo.nombre,
      tipoOperacion:          motivo.tipoOperacion,
      enProceso:              null,
      clienteAsignadoId:     deleteField(),
      clienteAsignadoNombre: deleteField(),
      fechaAsignacion:       deleteField(),
      updatedAt:             serverTimestamp(),
      historialAcciones:     arrayUnion(
        accion(actor, 'retirada', `De ${clientName}`),
        accion(actor, 'reingreso_taller', motivo.nombre),
      ),
    })

    const asignacionRef = doc(collection(db, ASIGNACIONES))
    const asignacion: Omit<AsignacionHeladera, 'id'> = {
      heladeraId,
      heladeraCodigo: heladera.codigoInterno,
      clientId,
      clientName,
      tipo:           'retiro',
      numero,
      firmaDataUrl,
      motivo:         motivo.nombre,
      actor,
      fecha,
    }
    tx.set(asignacionRef, asignacion)
    return { id: asignacionRef.id, ...asignacion }
  })
}
