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

// 12 meses desde la firma — período de renovación del comodato (ver
// plan: en Argentina es lo habitual para poder actualizar cláusulas de
// multa/garantía en pesos frente a la inflación).
function agregarUnAnio(fecha: Timestamp): Timestamp {
  const d = fecha.toDate()
  d.setFullYear(d.getFullYear() + 1)
  return Timestamp.fromDate(d)
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
  // Sucursal puntual del cliente (obligatoria cuando el cliente tiene más de
  // una dirección cargada — ver Heladera.clienteAsignadoDireccionId).
  direccion?:   { id: string; address: string },
  // Quién firma el contrato de comodato por el cliente, y n° de compresor
  // del equipo (se carga una sola vez, no se vuelve a pedir en la renovación).
  firmante?:    { nombre: string; cargo: string },
  compresor?:   string,
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
      estado:                     'en_comodato',
      clienteAsignadoId:          cliente.id,
      clienteAsignadoNombre:      cliente.nombre,
      clienteAsignadoDireccionId: direccion?.id ?? null,
      clienteAsignadoDireccion:   direccion?.address ?? null,
      fechaAsignacion:            fecha,
      compresor:                  compresor?.trim() || null,
      comodatoNumero:             numero,
      comodatoFirmadoEl:          fecha,
      comodatoVenceEl:            agregarUnAnio(fecha),
      comodatoAvisoEnviado:       false,
      updatedAt:                  serverTimestamp(),
      historialAcciones:          arrayUnion(accion(actor, 'asignada', `A ${cliente.nombre}${direccion?.address ? ` (${direccion.address})` : ''}`)),
    })

    const asignacionRef = doc(collection(db, ASIGNACIONES))
    const asignacion: Omit<AsignacionHeladera, 'id'> = {
      heladeraId,
      heladeraCodigo: heladera.codigoInterno,
      clientId:       cliente.id,
      clientName:     cliente.nombre,
      direccionId:    direccion?.id ?? null,
      direccion:      direccion?.address ?? null,
      tipo:           'asignacion',
      numero,
      firmaDataUrl,
      firmanteNombre: firmante?.nombre ?? null,
      firmanteCargo:  firmante?.cargo ?? null,
      compresor:      compresor?.trim() || null,
      actor,
      fecha,
    }
    tx.set(asignacionRef, asignacion)
    return { id: asignacionRef.id, ...asignacion }
  })

// Renueva el comodato de una heladera YA asignada: vuelve a pedir firma
// (mismo contrato, fecha y número nuevos) sin tocar cliente/sucursal/estado
// — a diferencia de asignarHeladera, no hay traslado físico del equipo, así
// que no genera una nueva orden de entrega.
export const renovarComodato = (
  heladeraId:   string,
  actor:        Actor,
  firmaDataUrl: string,
  firmante:     { nombre: string; cargo: string },
): Promise<AsignacionHeladera> =>
  runTransaction(db, async (tx) => {
    const heladeraRef = doc(db, HELADERAS, heladeraId)
    const heladeraSnap = await tx.get(heladeraRef)
    const heladera = heladeraSnap.data() as Heladera | undefined
    if (!heladera || heladera.estado !== 'en_comodato' || !heladera.clienteAsignadoId) {
      throw new HeladeraNoAsignableError('Esta heladera no está asignada a ningún cliente.')
    }

    const counterSnap = await tx.get(COUNTER_REF())
    const numero = (counterSnap.exists() ? (counterSnap.data().next as number) : 1)
    tx.set(COUNTER_REF(), { next: numero + 1 })

    const fecha = Timestamp.now()
    tx.update(heladeraRef, {
      comodatoNumero:       numero,
      comodatoFirmadoEl:    fecha,
      comodatoVenceEl:      agregarUnAnio(fecha),
      comodatoAvisoEnviado: false,
      updatedAt:            serverTimestamp(),
      historialAcciones:    arrayUnion(accion(actor, 'comodato_renovado', `Firmado por ${firmante.nombre} (${firmante.cargo})`)),
    })

    const asignacionRef = doc(collection(db, ASIGNACIONES))
    const asignacion: Omit<AsignacionHeladera, 'id'> = {
      heladeraId,
      heladeraCodigo: heladera.codigoInterno,
      clientId:       heladera.clienteAsignadoId,
      clientName:     heladera.clienteAsignadoNombre ?? '—',
      direccionId:    heladera.clienteAsignadoDireccionId ?? null,
      direccion:      heladera.clienteAsignadoDireccion ?? null,
      tipo:           'renovacion',
      numero,
      firmaDataUrl,
      firmanteNombre: firmante.nombre,
      firmanteCargo:  firmante.cargo,
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
      clienteAsignadoId:          deleteField(),
      clienteAsignadoNombre:      deleteField(),
      clienteAsignadoDireccionId: deleteField(),
      clienteAsignadoDireccion:   deleteField(),
      fechaAsignacion:       deleteField(),
      comodatoNumero:        deleteField(),
      comodatoFirmadoEl:     deleteField(),
      comodatoVenceEl:       deleteField(),
      comodatoAvisoEnviado:  deleteField(),
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
      direccionId:    heladera.clienteAsignadoDireccionId ?? null,
      direccion:      heladera.clienteAsignadoDireccion ?? null,
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
