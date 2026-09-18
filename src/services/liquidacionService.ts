import { collection, doc, getDoc, onSnapshot, query, runTransaction, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { ChequeRendido, ConteoBilletes, DesvioLiquidacion, EmpresaTango, Liquidacion, MotivoDiferenciaLiquidacion, PlantaId, RetencionRendida } from '../types'
import { PlataCalculada, codigoLiquidacion, referenciasDelReparto, serieLiquidacion } from '../utils/liquidacion'
import { todayString } from '../utils/helpers'

export class LiquidacionYaCerradaError extends Error {
  constructor() { super('La liquidación de este repartidor para ese día ya está cerrada.') }
}
// Contador por persona: config/liquidacionCounter_{clave} (serieLiquidacion).
const COUNTER_REF = (clave: string) => doc(db, 'config', `liquidacionCounter_${clave}`)

const LIQUIDACIONES = 'liquidaciones'

// ID determinístico. Las reglas solo permiten create (nunca update) → un
// segundo cierre falla en vez de pisar el snapshot.
//
// Desde el 2026-09-18 la plata de un VIAJE se guarda por su remito, porque su
// otra mitad (el cierre de mercadería) también es del viaje y las dos tienen que
// apuntar a lo mismo. Un chofer puede hacer dos viajes en un día, y el segundo no
// puede pisar la rendición del primero.
//
// Los cobradores y supervisores no tienen camión ni viaje: siguen con la clave
// por día, que es como rinden.
export const liquidacionId = (fecha: string, choferId: string) => `${fecha}_${choferId}`
export const liquidacionIdDeViaje = (remitoId: string) => remitoId

export async function cerrarLiquidacion(
  args: {
    fecha?:            string   // yyyy-MM-dd, default hoy
    choferId:          string
    choferNombre:      string
    depositoTango?:       string
    depositoTangoNombre?: string
    /**
     * El viaje que se rinde (2026-09-18). Con viaje, la liquidación se guarda por
     * su remito; sin viaje (cobradores, supervisores) sigue la clave por día.
     */
    remitoId?:         string
    remitoCodigo?:     string
    /**
     * Cuando el sobre venía del buzón (2026-09-18): el chofer volvió fuera del
     * horario de caja, dejó la plata con el código de la descarga escrito a mano
     * y se fue. Queda quién abrió el buzón y cuándo, que es el único tramo del
     * circuito que si no se registra no deja rastro de nadie.
     */
    buzon?:            { descargaCodigo: string }
    calculo:           PlataCalculada
    efectivoRecibido:  number
    // Rendición por sobres, etapa 1 (2026-09-16): el conteo de billetes por
    // empresa es obligatorio (las reglas exigen que sume `efectivoRecibido`).
    conteoBilletes:        ConteoBilletes
    diferenciaPorEmpresa?: Record<EmpresaTango, number>
    // Cierre con control (2026-09-06)
    diferencia?:           { motivo: MotivoDiferenciaLiquidacion; nota: string; denominacion?: number }
    // Faltante de mercadería observado al cerrar (2026-09-13): el cierre se
    // completa igual (un tema de stock no traba la caja) y queda marcado.
    desvio?:               DesvioLiquidacion
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
  const id    = args.remitoId ? liquidacionIdDeViaje(args.remitoId) : liquidacionId(fecha, args.choferId)
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
      ...(args.remitoId ? { remitoId: args.remitoId, remitoCodigo: args.remitoCodigo ?? '' } : {}),
      ...(args.buzon ? { buzon: { abiertoPor: { uid: actor.uid, nombre: actor.nombre }, abiertoEn: Timestamp.now(), descargaCodigo: args.buzon.descargaCodigo } } : {}),
      ...args.calculo,
      efectivoRecibido:   args.efectivoRecibido,
      diferenciaEfectivo: args.efectivoRecibido - args.calculo.efectivoARendir,
      conteoBilletes:     args.conteoBilletes,
      ...(args.diferenciaPorEmpresa ? { diferenciaPorEmpresa: args.diferenciaPorEmpresa } : {}),
      ...(args.diferencia ? { diferencia: args.diferencia } : {}),
      ...(args.desvio ? { desvio: args.desvio } : {}),
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

/** La plata de un VIAJE, en vivo (2026-09-18). Mismo cuidado con el error que arriba. */
export const subscribeLiquidacionDeViaje = (
  remitoId: string,
  callback: (liquidacion: Liquidacion | null) => void,
): () => void =>
  onSnapshot(
    doc(db, LIQUIDACIONES, liquidacionIdDeViaje(remitoId)),
    (snap) => callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Liquidacion) : null),
    (err) => { reportError(err, { subscription: 'liquidaciones-viaje', remitoId }); callback(null) },
  )

/** Las liquidaciones de varios viajes, por id (buzón, liquidaciones abiertas, historial). */
export const getLiquidacionesDeViajes = async (remitoIds: string[]): Promise<Map<string, Liquidacion>> => {
  const snaps = await Promise.all(remitoIds.map((id) => getDoc(doc(db, LIQUIDACIONES, id))))
  const out = new Map<string, Liquidacion>()
  snaps.forEach((s) => { if (s.exists()) out.set(s.id, { id: s.id, ...s.data() } as Liquidacion) })
  return out
}
