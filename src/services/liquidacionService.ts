import { doc, getDoc, onSnapshot, setDoc, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { Liquidacion, PlantaId } from '../types'
import { LiquidacionCalculada } from '../utils/liquidacion'
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
    calculo:           LiquidacionCalculada
    efectivoRecibido:  number
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
    ...args.calculo,
    efectivoRecibido:   args.efectivoRecibido,
    diferenciaEfectivo: args.efectivoRecibido - args.calculo.efectivoARendir,
    cerradaPor:   { uid: actor.uid, nombre: actor.nombre },
    createdAt:    Timestamp.now(),
  }
  await setDoc(doc(db, LIQUIDACIONES, id), liquidacion)
  return { id, ...liquidacion }
}

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
