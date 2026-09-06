import { collection, doc, getDoc, onSnapshot, query, setDoc, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { reportError, esperarOEncolar } from './observability'
import { Liquidacion, MotivoDiferenciaLiquidacion, PlantaId } from '../types'
import { LiquidacionCalculada, referenciasDelReparto } from '../utils/liquidacion'
import { todayString } from '../utils/helpers'

const LIQUIDACIONES = 'liquidaciones'

// ID determinístico: una liquidación por chofer y día. Las reglas solo
// permiten create (nunca update) → un segundo cierre del mismo día falla en
// vez de pisar el snapshot.
export const liquidacionId = (fecha: string, choferId: string) => `${fecha}_${choferId}`

export async function cerrarLiquidacion(
  args: {
    fecha?:            string   // yyyy-MM-dd, default hoy
    choferId:          string
    choferNombre:      string
    depositoTango?:       string
    depositoTangoNombre?: string
    calculo:           LiquidacionCalculada
    efectivoRecibido:  number
    // Cierre con control (2026-09-06)
    diferencia?:           { motivo: MotivoDiferenciaLiquidacion; nota: string }
    firmaRepartidor?:      string
    firmanteRepartidor?:   string
    confirmoSinPendientes?: boolean
    referencias?:          ReturnType<typeof referenciasDelReparto>
  },
  actor: { uid: string; nombre: string; plantaId: PlantaId },
): Promise<Liquidacion> {
  const fecha = args.fecha ?? todayString()
  const id    = liquidacionId(fecha, args.choferId)
  const liquidacion: Omit<Liquidacion, 'id'> = {
    fecha,
    plantaId:     actor.plantaId,
    choferId:     args.choferId,
    choferNombre: args.choferNombre,
    ...(args.depositoTango ? { depositoTango: args.depositoTango, depositoTangoNombre: args.depositoTangoNombre ?? '' } : {}),
    ...args.calculo,
    efectivoRecibido:   args.efectivoRecibido,
    diferenciaEfectivo: args.efectivoRecibido - args.calculo.efectivoARendir,
    ...(args.diferencia ? { diferencia: args.diferencia } : {}),
    ...(args.firmaRepartidor ? { firmaRepartidor: args.firmaRepartidor, firmanteRepartidor: args.firmanteRepartidor ?? '' } : {}),
    ...(args.confirmoSinPendientes !== undefined ? { confirmoSinPendientes: args.confirmoSinPendientes } : {}),
    ...(args.referencias ?? {}),
    cerradaPor:   { uid: actor.uid, nombre: actor.nombre },
    createdAt:    Timestamp.now(),
  }
  // Hasta 4 s de espera al servidor. Sin red el cierre queda en el cache
  // local y se sube solo; si mientras tanto alguien lo cierra desde otra
  // terminal, las reglas (create-only) rechazan el segundo y queda reportado.
  await esperarOEncolar(setDoc(doc(db, LIQUIDACIONES, id), liquidacion), { origen: 'cerrarLiquidacion', id })
  return { id, ...liquidacion }
}

// Historial (2026-09-06): todos los cierres cuya fecha (yyyy-MM-dd) cae en
// [desde, hasta). Rango sobre un solo campo → no necesita índice compuesto;
// la planta se filtra del lado del cliente (son pocos docs por mes).
export const subscribeLiquidacionesEnRango = (
  desde: string,
  hasta: string,
  callback: (liquidaciones: Liquidacion[]) => void,
  plantaId?: PlantaId,
): () => void =>
  onSnapshot(
    query(collection(db, LIQUIDACIONES), where('fecha', '>=', desde), where('fecha', '<', hasta)),
    (snap) => {
      const todas = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Liquidacion)
      callback(plantaId ? todas.filter((l) => l.plantaId === plantaId) : todas)
    },
    (err) => { reportError(err, { subscription: 'liquidaciones-rango', desde, hasta }); callback([]) },
  )

export const getLiquidacion = async (fecha: string, choferId: string): Promise<Liquidacion | null> => {
  const snap = await getDoc(doc(db, LIQUIDACIONES, liquidacionId(fecha, choferId)))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Liquidacion) : null
}

// La liquidación del día de un chofer, en vivo (para que la pantalla de caja
// muestre "ya cerrada" apenas alguien la cierra en otra terminal).
export const subscribeLiquidacion = (
  fecha: string,
  choferId: string,
  callback: (liquidacion: Liquidacion | null) => void,
): () => void =>
  onSnapshot(
    doc(db, LIQUIDACIONES, liquidacionId(fecha, choferId)),
    (snap) => callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Liquidacion) : null),
    // Un error de lectura acá es delicado: si se traga como null, la UI cree que
    // la liquidación NO está cerrada y deja cerrarla de nuevo. Se reporta.
    (err) => { reportError(err, { subscription: 'liquidaciones', fecha, choferId }); callback(null) },
  )
