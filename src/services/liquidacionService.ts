import { collection, doc, getDoc, onSnapshot, query, runTransaction, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { ChequeRendido, Liquidacion, MotivoDiferenciaLiquidacion, PlantaId, RetencionRendida } from '../types'
import { LiquidacionCalculada, codigoLiquidacion, referenciasDelReparto, serieLiquidacion } from '../utils/liquidacion'
import { todayString } from '../utils/helpers'

export class LiquidacionYaCerradaError extends Error {
  constructor() { super('La liquidación de este repartidor para ese día ya está cerrada.') }
}
// Contador por persona: config/liquidacionCounter_{clave} (serieLiquidacion).
const COUNTER_REF = (clave: string) => doc(db, 'config', `liquidacionCounter_${clave}`)

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
    firmaRepartidor:       string
    firmanteRepartidor:    string
    // Firma de quien recibe (el cajero) y los valores en papel tildados (2026-09-09)
    firmaRecibe:           string
    firmanteRecibe:        string
    cheques:               ChequeRendido[]
    retenciones:           RetencionRendida[]
    valoresFaltantes:      { cantidad: number; total: number }
    confirmoSinPendientes?: boolean
    referencias?:          ReturnType<typeof referenciasDelReparto>
  },
  actor: { uid: string; nombre: string; plantaId: PlantaId },
): Promise<Liquidacion> {
  const fecha = args.fecha ?? todayString()
  const id    = liquidacionId(fecha, args.choferId)
  const ref   = doc(db, LIQUIDACIONES, id)
  const serie = serieLiquidacion(args.choferId, args.depositoTango)
  // Número correlativo por persona y doc en la misma transacción (patrón
  // rendiciones). Caja está online: se espera al servidor; un segundo cierre
  // del mismo día falla acá antes de tocar el contador.
  const liquidacion = await runTransaction(db, async (tx) => {
    const [existente, counterSnap] = await Promise.all([tx.get(ref), tx.get(COUNTER_REF(serie.clave))])
    if (existente.exists()) throw new LiquidacionYaCerradaError()
    const numero = counterSnap.exists() ? (counterSnap.data().next as number) : 1
    tx.set(COUNTER_REF(serie.clave), { next: numero + 1 })
    const data: Omit<Liquidacion, 'id'> = {
      numero,
      codigo:       codigoLiquidacion(serie.prefijo, numero),
      fecha,
      plantaId:     actor.plantaId,
      choferId:     args.choferId,
      choferNombre: args.choferNombre,
      ...(args.depositoTango ? { depositoTango: args.depositoTango, depositoTangoNombre: args.depositoTangoNombre ?? '' } : {}),
      ...args.calculo,
      efectivoRecibido:   args.efectivoRecibido,
      diferenciaEfectivo: args.efectivoRecibido - args.calculo.efectivoARendir,
      ...(args.diferencia ? { diferencia: args.diferencia } : {}),
      firmaRepartidor: args.firmaRepartidor, firmanteRepartidor: args.firmanteRepartidor,
      firmaRecibe: args.firmaRecibe, firmanteRecibe: args.firmanteRecibe,
      cheques: args.cheques, retenciones: args.retenciones, valoresFaltantes: args.valoresFaltantes,
      ...(args.confirmoSinPendientes !== undefined ? { confirmoSinPendientes: args.confirmoSinPendientes } : {}),
      ...(args.referencias ?? {}),
      cerradaPor:   { uid: actor.uid, nombre: actor.nombre },
      createdAt:    Timestamp.now(),
      entregaId:    null,
    }
    tx.set(ref, data)
    return data
  })
  return { id, ...liquidacion }
}

/** Liquidaciones de una persona en varios días (ids determinísticos, un getDoc por día). */
export async function getLiquidacionesDeChofer(choferId: string, fechas: string[]): Promise<Liquidacion[]> {
  const snaps = await Promise.all(fechas.map((f) => getDoc(doc(db, LIQUIDACIONES, liquidacionId(f, choferId)))))
  return snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }) as Liquidacion)
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
