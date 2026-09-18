// Borradores de carga (2026-09-18).
//
// Caja arma el borrador: qué mercadería va, a qué camión y para qué repartidor.
// No es un documento fiscal — no tiene número, ni COT, ni remito R, y no mueve
// stock en Tango. Es la instrucción para el muelle.
//
// El remito nace después, cuando muelle entrega el camión (ver
// `emitirRemitoDesdeBorrador` en remitoCargaService.ts). Antes el remito y el COT
// se emitían la tarde anterior y el camión salía a las 4 de la mañana con una
// hora de traslado que no era la real, que es justo lo que ARBA mira.
//
// El borrador se muere solo: si el camión no sale, vence y no queda nada colgado.

import {
  collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError, esperarOEncolar } from './observability'
import {
  BorradorCarga, CotDestinoPlan, EnvasesCarga, PlantaId, RemitoCargaItem,
} from '../types'
import { claveDia } from '../utils/diaReparto'

const BORRADORES = 'borradoresCarga'

export interface ActorCajaBorrador { uid: string; nombre: string; plantaId: PlantaId }

export interface CrearBorradorArgs {
  /** Día del viaje previsto (yyyy-MM-dd). El del primer viaje se arma el día anterior. */
  paraFecha:    string
  camionId:     string
  camionLabel:  string
  choferId:     string
  choferNombre: string
  depositoTango?:       string
  depositoTangoNombre?: string
  items:        RemitoCargaItem[]
  envases:      EnvasesCarga
  kg?:          number
  /**
   * Destino del COT. Se pide SIEMPRE, aunque la carga planificada no llegue al
   * umbral: si muelle corrige hacia arriba y lo cruza, el COT tiene que poder
   * salir sin ir a buscar al destinatario a las 4 de la mañana.
   */
  cotDestino:   CotDestinoPlan
}

/**
 * Hasta cuándo vale un borrador: el fin del día siguiente al del viaje. Después
 * lo marca vencido el barrido diario. Un día de gracia porque el camión que sale
 * a las 4 del martes se carga el lunes a la tarde, y una demora de una noche no
 * tiene que obligar a rehacerlo.
 */
export function vencimientoDe(paraFecha: string): Date {
  const [a, m, d] = paraFecha.split('-').map(Number)
  return new Date(a, m - 1, d + 1, 23, 59, 59)
}

export async function crearBorradorCarga(
  args: CrearBorradorArgs,
  actor: ActorCajaBorrador,
): Promise<BorradorCarga> {
  const ref = doc(collection(db, BORRADORES))
  const borrador: Omit<BorradorCarga, 'id'> = {
    plantaId:     actor.plantaId,
    paraFecha:    args.paraFecha,
    camionId:     args.camionId,
    camionLabel:  args.camionLabel,
    choferId:     args.choferId,
    choferNombre: args.choferNombre,
    ...(args.depositoTango ? { depositoTango: args.depositoTango, depositoTangoNombre: args.depositoTangoNombre ?? '' } : {}),
    items:        args.items,
    envases:      { tarimasMadera: args.envases.tarimasMadera, palletsMetal: args.envases.palletsMetal, racks: [...args.envases.racks] },
    ...(args.kg !== undefined ? { kg: args.kg } : {}),
    cotDestino:   args.cotDestino,
    estado:       'pendiente',
    creadoPor:    { uid: actor.uid, nombre: actor.nombre },
    fecha:        Timestamp.now(),
    venceEn:      Timestamp.fromDate(vencimientoDe(args.paraFecha)),
  }
  await esperarOEncolar(setDoc(ref, borrador), { origen: 'crearBorradorCarga', camionId: args.camionId })
  return { id: ref.id, ...borrador }
}

/** Caja corrige un borrador que todavía nadie aceptó. */
export const editarBorradorCarga = (
  id: string,
  cambios: Partial<Pick<BorradorCarga, 'items' | 'envases' | 'kg' | 'cotDestino' | 'paraFecha' | 'camionId' | 'camionLabel' | 'choferId' | 'choferNombre' | 'depositoTango' | 'depositoTangoNombre'>>,
): Promise<unknown> =>
  esperarOEncolar(updateDoc(doc(db, BORRADORES, id), cambios), { origen: 'editarBorradorCarga', id })

/**
 * Muelle marca en qué dársena está cargando el camión. Va sobre el borrador y no
 * sobre el remito porque cuando el camión entra a la boca el remito todavía no
 * existe: nace recién cuando muelle lo entrega.
 */
export const asignarDarsenaBorrador = (id: string, darsena: number): Promise<unknown> =>
  esperarOEncolar(
    updateDoc(doc(db, BORRADORES, id), { darsena, darsenaAsignadaEn: Timestamp.now() }),
    { origen: 'asignarDarsenaBorrador', id, darsena },
  )

/** Caja da de baja un borrador que no va a usarse (el camión no sale, se rehace la carga). */
export const borrarBorradorCarga = (id: string): Promise<unknown> =>
  esperarOEncolar(deleteDoc(doc(db, BORRADORES, id)), { origen: 'borrarBorradorCarga', id })

/**
 * Los borradores de una planta para un día. Muelle mira los de hoy (y los de
 * ayer que quedaron pendientes, por el camión que sale a las 4); caja mira los
 * que armó para mañana.
 */
export const subscribeBorradoresDe = (
  plantaId: PlantaId,
  paraFechas: string[],
  callback: (borradores: BorradorCarga[]) => void,
): () => void => {
  if (!paraFechas.length) { callback([]); return () => {} }
  return onSnapshot(
    query(
      collection(db, BORRADORES),
      where('plantaId', '==', plantaId),
      where('paraFecha', 'in', paraFechas.slice(0, 10)),
    ),
    (snap) => callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as BorradorCarga))
        .sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis()),
    ),
    onSnapshotError(callback, BORRADORES),
  )
}

/** Fecha de mañana en clave yyyy-MM-dd, que es para cuándo caja arma la carga de la madrugada. */
export const manana = (hoy = new Date()): string => {
  const d = new Date(hoy)
  d.setDate(d.getDate() + 1)
  return claveDia(d)
}
