import {
  collection,
  updateDoc,
  doc,
  getDoc,
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
import { AreaHeladera, EstadoHeladera, Heladera, TipoOperacionIngreso, TipoPipelineHeladera } from '../types'
import {
  CatalogoPasos, pasoActual, primerPasoActivo,
  puedeAgarrar, puedeSoltar, puedeResolverAprobacion, puedeLiberar,
} from '../utils/heladeraPipeline'

const HELADERAS = 'heladeras'
const CODIGO_INDEX = 'heladeraCodigoIndex'

export interface Actor { uid: string; nombre: string }

function accion(
  actor: Actor,
  tipo: string,
  detalle?: string | null,
  estadoOrigen?: EstadoHeladera,
  estadoDestino?: EstadoHeladera,
  pasoId?: string | null,
) {
  return {
    accion:        tipo,
    usuarioId:     actor.uid,
    usuarioNombre: actor.nombre,
    timestamp:     Timestamp.now(),
    detalle:       detalle ?? null,
    estadoOrigen:  estadoOrigen ?? null,
    estadoDestino: estadoDestino ?? null,
    pasoId:        pasoId ?? null,
  }
}

export class HeladeraNoDisponibleError extends Error {}
export class CodigoHeladeraDuplicadoError extends Error {}
export class PipelineSinPasosError extends Error {}

export const getHeladera = async (id: string): Promise<Heladera | null> => {
  const snap = await getDoc(doc(db, HELADERAS, id))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Heladera) : null
}

export const subscribeHeladeras = (
  callback: (heladeras: Heladera[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, HELADERAS), orderBy('updatedAt', 'desc'), limit(500)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Heladera))),
    () => callback([]),
  )

// Heladeras actualmente en comodato de un cliente — pantalla "Mis heladeras"
// del cliente (`clienteAsignadoId` solo refleja el estado ACTUAL, ver types.ts).
export const subscribeHeladerasPorCliente = (
  clientId: string,
  callback: (heladeras: Heladera[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, HELADERAS), where('clienteAsignadoId', '==', clientId), where('estado', '==', 'en_comodato')),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Heladera))),
    () => callback([]),
  )

// El código interno NO se autogenera: la empresa ya tiene su propio esquema
// de numeración. Se valida unicidad con un doc índice creado en la misma
// transacción (mismo patrón anti-poisoning que cuitIndex).
export const crearHeladera = (
  data: {
    numeroSerie:         string
    codigoInterno:       string
    modeloId:            string
    modeloNombre:        string
    tipoPipeline:        TipoPipelineHeladera
    // Solo aplica a reacondicionamiento — fabricación no tiene motivo de ingreso.
    motivoIngresoId?:     string
    motivoIngresoNombre?: string
    tipoOperacion?:       TipoOperacionIngreso
    observaciones?:      string
  },
  actor:    Actor,
  catalogo: CatalogoPasos,
): Promise<void> => {
  const primerPaso = primerPasoActivo(catalogo, data.tipoPipeline)
  if (!primerPaso) {
    throw new PipelineSinPasosError('Todavía no hay pasos configurados para este pipeline — agregá uno primero en "Catálogos de service".')
  }
  return runTransaction(db, async (tx) => {
    const codigoRef  = doc(db, CODIGO_INDEX, data.codigoInterno)
    const codigoSnap = await tx.get(codigoRef)
    if (codigoSnap.exists()) {
      throw new CodigoHeladeraDuplicadoError('Ese código ya está en uso por otra heladera.')
    }
    const heladeraRef = doc(collection(db, HELADERAS))
    tx.set(heladeraRef, {
      numeroSerie:           data.numeroSerie,
      codigoInterno:         data.codigoInterno,
      modeloId:              data.modeloId,
      modelo:                data.modeloNombre,
      estado:                'en_taller',
      tipoPipeline:          data.tipoPipeline,
      pasoActualId:          primerPaso.id,
      primerPasoId:          primerPaso.id,
      motivoIngresoId:       data.motivoIngresoId ?? null,
      motivoIngresoNombre:   data.motivoIngresoNombre ?? null,
      tipoOperacion:         data.tipoOperacion ?? null,
      observacionesIngreso:  data.observaciones?.trim() || null,
      creadoPor:             { uid: actor.uid, nombre: actor.nombre },
      fechaIngreso:          serverTimestamp(),
      cicloActual:           1,
      enProceso:             null,
      motivoBaja:            null,
      historialAcciones:     [accion(actor, 'creada', data.motivoIngresoNombre ?? primerPaso.nombre)],
      createdAt:             serverTimestamp(),
      updatedAt:             serverTimestamp(),
    })
    tx.set(codigoRef, { heladeraId: heladeraRef.id })
  })
}

// Agarrar el paso actual del pipeline: solo el área dueña de ESE paso, y
// solo cuando la heladera está en cola (sin enProceso). `actorArea` es el
// área del que agarra — se valida contra el área del paso antes de escribir
// (las Firestore rules hacen la misma validación del lado del servidor).
export const agarrarPaso = (
  heladeraId: string,
  actor:      Actor,
  actorArea:  AreaHeladera,
  catalogo:   CatalogoPasos,
): Promise<void> =>
  runTransaction(db, async (tx) => {
    const ref  = doc(db, HELADERAS, heladeraId)
    const snap = await tx.get(ref)
    const data = snap.data() as Heladera | undefined
    if (!data || !puedeAgarrar(data, catalogo, actorArea)) {
      throw new HeladeraNoDisponibleError('Esta heladera no está lista para este paso, o ya la tiene alguien.')
    }
    tx.update(ref, {
      enProceso: { uid: actor.uid, nombre: actor.nombre, area: actorArea, desde: Timestamp.now() },
      updatedAt: serverTimestamp(),
    })
  })

// Soltar un paso "simple" (sin requiereAprobacion): avanza a
// paso.siguientePasoId, o a 'disponible' si era el último paso activo del
// pipeline. Los pasos con requiereAprobacion (ej. control de calidad) usan
// aprobarPaso/rechazarPaso en su lugar.
export const soltarPaso = (
  heladeraId: string,
  actor:      Actor,
  detalle:    string,
  catalogo:   CatalogoPasos,
): Promise<void> =>
  runTransaction(db, async (tx) => {
    const ref  = doc(db, HELADERAS, heladeraId)
    const snap = await tx.get(ref)
    const data = snap.data() as Heladera | undefined
    if (!data || !puedeSoltar(data, catalogo, actor.uid)) {
      throw new HeladeraNoDisponibleError('No tenés esta heladera agarrada.')
    }
    const paso = pasoActual(data, catalogo)!
    const siguiente   = paso.siguientePasoId
    const nuevoEstado: EstadoHeladera = siguiente ? 'en_taller' : 'disponible'
    tx.update(ref, {
      estado:            nuevoEstado,
      pasoActualId:      siguiente ?? null,
      enProceso:         deleteField(),
      updatedAt:         serverTimestamp(),
      historialAcciones: arrayUnion(accion(actor, 'paso_completado', detalle, data.estado, nuevoEstado, paso.id)),
    })
  })

export const aprobarPaso = (
  heladeraId: string,
  actor:      Actor,
  catalogo:   CatalogoPasos,
  detalle?:   string,
): Promise<void> =>
  runTransaction(db, async (tx) => {
    const ref  = doc(db, HELADERAS, heladeraId)
    const snap = await tx.get(ref)
    const data = snap.data() as Heladera | undefined
    if (!data || !puedeResolverAprobacion(data, catalogo, actor.uid)) {
      throw new HeladeraNoDisponibleError('No tenés esta heladera en este paso.')
    }
    const paso = pasoActual(data, catalogo)!
    const siguiente   = paso.siguientePasoId
    const nuevoEstado: EstadoHeladera = siguiente ? 'en_taller' : 'disponible'
    tx.update(ref, {
      estado:            nuevoEstado,
      pasoActualId:      siguiente ?? null,
      enProceso:         deleteField(),
      updatedAt:         serverTimestamp(),
      historialAcciones: arrayUnion(accion(actor, 'paso_aprobado', detalle ?? null, data.estado, nuevoEstado, paso.id)),
    })
  })

// Rechazo: vuelve al primer paso del pipeline (snapshot tomado al alta) para
// un reprocesamiento completo (nuevo ciclo) — no hay "retroceso" a mitad de
// pipeline.
export const rechazarPaso = (
  heladeraId: string,
  actor:      Actor,
  motivo:     string,
  catalogo:   CatalogoPasos,
): Promise<void> =>
  runTransaction(db, async (tx) => {
    const ref  = doc(db, HELADERAS, heladeraId)
    const snap = await tx.get(ref)
    const data = snap.data() as Heladera | undefined
    if (!data || !puedeResolverAprobacion(data, catalogo, actor.uid) || !data.primerPasoId) {
      throw new HeladeraNoDisponibleError('No tenés esta heladera en este paso.')
    }
    tx.update(ref, {
      estado:            'en_taller',
      pasoActualId:      data.primerPasoId,
      enProceso:         deleteField(),
      cicloActual:       (data.cicloActual ?? 1) + 1,
      updatedAt:         serverTimestamp(),
      historialAcciones: arrayUnion(accion(actor, 'paso_rechazado', motivo, data.estado, 'en_taller', data.pasoActualId)),
    })
  })

// Uso del encargado: libera una heladera que quedó agarrada sin que nadie
// la soltara (alguien se olvidó) — es una corrección administrativa, no una
// transición de negocio. El paso actual no cambia.
export const liberarForzado = (
  heladeraId: string,
  actor:      Actor,
): Promise<void> =>
  runTransaction(db, async (tx) => {
    const ref  = doc(db, HELADERAS, heladeraId)
    const snap = await tx.get(ref)
    const data = snap.data() as Heladera | undefined
    if (!data || !puedeLiberar(data)) {
      throw new HeladeraNoDisponibleError('Esta heladera no está agarrada por nadie.')
    }
    tx.update(ref, {
      enProceso:         deleteField(),
      updatedAt:         serverTimestamp(),
      historialAcciones: arrayUnion(accion(actor, 'liberada_por_encargado', null, data.estado, data.estado)),
    })
  })

export const marcarBaja = (
  heladeraId: string,
  actor:      Actor,
  motivo:     string,
): Promise<void> =>
  updateDoc(doc(db, HELADERAS, heladeraId), {
    estado:            'baja',
    motivoBaja:        motivo,
    enProceso:          deleteField(),
    updatedAt:          serverTimestamp(),
    historialAcciones: arrayUnion(accion(actor, 'baja', motivo)),
  })
