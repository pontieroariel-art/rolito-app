import {
  collection, doc, onSnapshot, query, runTransaction, updateDoc, where, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError, esperarOEncolar } from './observability'
import { BorradorCarga, CotSolicitud, EnvasesCarga, RemitoCarga, RemitoCargaItem, PlantaId } from '../types'
import { PLANTA_INFO } from '../utils/constants'
import { claveDia } from '../utils/diaReparto'

const REMITOS = 'remitosCarga'

// Contador correlativo por planta (config/cargaCounter_torcuato / _merlo) —
// mismo patrón transaccional que produccionCounterService, pero SIN reserva de
// lotes offline ni inicialización manual: caja opera desde una PC con red, y
// la serie RC- arranca en 1 (numeración nueva de la app, no continúa la del
// sistema viejo).
const COUNTER_REF = (plantaId: PlantaId) => doc(db, 'config', `cargaCounter_${plantaId}`)

export const codigoRemitoCarga = (plantaId: PlantaId, numero: number): string =>
  `RC-${PLANTA_INFO[plantaId].prefijoCodigo}-${String(numero).padStart(6, '0')}`

export interface ActorCaja { uid: string; nombre: string; plantaId: PlantaId }

// palletsInfo vive en utils/helpers (función pura, testeable sin Firebase). Se
// reexporta acá porque la pantalla de caja la importa desde este service.
export { palletsInfo, type PalletsInfo } from '../utils/helpers'

export interface CrearRemitoCargaArgs {
  camionId:     string
  camionLabel:  string
  choferId:     string       // identidad del depósito (uid o 'dep:<código>')
  choferNombre: string
  depositoTango?:       string
  depositoTangoNombre?: string
  items:        RemitoCargaItem[]
  // Composición de envases que salen (caja la declara; muelle se la dicta).
  // palletsCarga se deriva acá: tarimasMadera + palletsMetal.
  envases:      EnvasesCarga
  /** COT de ARBA (2026-09-10): kilos de la carga y, si requiere COT, lo que caja declara. */
  kg?:          number
  cotSolicitud?: CotSolicitud
  /** Talonario con que la app numera el remito R oficial de la carga (config/cot.respaldo con CAI vigente). */
  remitoR?:     { puntoVenta: number; cai: string; vencimiento: string }
}

/** El remito R de carga se numera con un contador global (talonario 00025), no por planta. */
const REMITO_R_COUNTER_REF = () => doc(db, 'config', 'remitoCargaCounter')

export class TalonarioRemitoCargaNoInicializadoError extends Error {}

// Crea el remito con su número correlativo en una sola transacción (el
// contador se crea solo en el primer uso de cada planta). A diferencia de la
// venta del chofer esto SÍ espera al servidor: caja necesita el número
// definitivo para imprimir, y está en una PC con conexión.
export async function crearRemitoCarga(args: CrearRemitoCargaArgs, actor: ActorCaja): Promise<RemitoCarga> {
  const remitoRef = doc(collection(db, REMITOS))
  const data = await runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(COUNTER_REF(actor.plantaId))
    const numero = counterSnap.exists() ? (counterSnap.data().next as number) : 1
    // Remito R oficial (talonario 00025): el número sale del contador global en
    // la misma transacción, y queda también como respaldo de la solicitud de COT.
    let remitoR: RemitoCarga['remitoR'] | undefined
    let cotSolicitud = args.cotSolicitud
    if (args.remitoR) {
      const rSnap = await tx.get(REMITO_R_COUNTER_REF())
      if (!rSnap.exists()) throw new TalonarioRemitoCargaNoInicializadoError('El talonario del remito R de carga no está inicializado (Ajustes → COT de ARBA → próximo número).')
      const numeroR = Number(rSnap.data().next)
      // El CAI autoriza un rango de números (2026-09-12: 251 a 1750). Pasado el
      // último, el remito no valdría: hay que pedir un CAI nuevo y cargarlo.
      const ultimoR = rSnap.data().ultimo != null ? Number(rSnap.data().ultimo) : null
      if (ultimoR !== null && numeroR > ultimoR) throw new TalonarioRemitoCargaNoInicializadoError(`El talonario del remito R de carga se agotó (último número autorizado por el CAI: ${ultimoR}). Hay que pedir un CAI nuevo y cargarlo en Ajustes → COT de ARBA.`)
      tx.update(REMITO_R_COUNTER_REF(), { next: numeroR + 1 })
      remitoR = { puntoVenta: args.remitoR.puntoVenta, numero: numeroR, cai: args.remitoR.cai, vencimiento: args.remitoR.vencimiento }
      if (cotSolicitud) cotSolicitud = { ...cotSolicitud, respaldo: { ...cotSolicitud.respaldo, prefijo: args.remitoR.puntoVenta, numero: numeroR } }
    }
    tx.set(COUNTER_REF(actor.plantaId), { next: numero + 1 })

    const remito: Omit<RemitoCarga, 'id'> = {
      numero,
      codigo:       codigoRemitoCarga(actor.plantaId, numero),
      plantaId:     actor.plantaId,
      camionId:     args.camionId,
      camionLabel:  args.camionLabel,
      choferId:     args.choferId,
      choferNombre: args.choferNombre,
      ...(args.depositoTango ? { depositoTango: args.depositoTango, depositoTangoNombre: args.depositoTangoNombre ?? '' } : {}),
      items:        args.items,
      palletsCarga: args.envases.tarimasMadera + args.envases.palletsMetal,
      envases:      { tarimasMadera: args.envases.tarimasMadera, palletsMetal: args.envases.palletsMetal, racks: [...args.envases.racks] },
      estado:       'emitido',
      creadoPor:    { uid: actor.uid, nombre: actor.nombre },
      fecha:        Timestamp.now(),
      tango:        { estado: 'pendiente' },
      // COT de ARBA: los kilos siempre (para saber si lo requería) y la
      // solicitud solo cuando caja la completó; el resultado lo escribe el server.
      ...(args.kg !== undefined ? { kg: args.kg } : {}),
      ...(cotSolicitud ? { cotSolicitud } : {}),
      ...(remitoR ? { remitoR } : {}),
    }
    tx.set(remitoRef, remito)
    return remito
  })
  return { id: remitoRef.id, ...data }
}

export interface ActorMuelleEmite { uid: string; nombre: string; plantaId: PlantaId }

/** Lo que muelle corrigió del borrador: la cantidad que realmente subió al camión. */
export interface CorreccionMuelle { productoId: string; cantidad: number }

export class CamionConDescargaPendienteError extends Error {}

/**
 * Muelle confecciona el remito a partir del borrador (2026-09-18).
 *
 * Reemplaza a la emisión de caja, que salía la tarde anterior y por eso el COT
 * llevaba una hora que no era la del traslado. Ahora el papel nace cuando el
 * camión se va a cargar de verdad, con el COT de ese momento.
 *
 * Es el PRIMERO de dos actos (corrección de Ariel, 18/09): acá sale el papel
 * contra el que se carga y que mira seguridad, y el remito queda `emitido`.
 * Cuando la mercadería ya está arriba del camión, muelle marca la entrega
 * (`confirmarEntregaRemito`) y recién ahí pasa a `entregado`.
 *
 * Muelle puede corregir las cantidades del plan. Si lo que va a cargar no
 * coincide con lo que caja planificó, el remito sale con lo real y queda anotado
 * qué se corrigió: si la mayoría sale corregida, el problema no es el muelle, es
 * que caja está planificando sobre información vieja.
 */
export async function emitirRemitoDesdeBorrador(
  borrador: BorradorCarga,
  opciones: {
    correcciones?: CorreccionMuelle[]
    /**
     * Los envases que salen los cuenta MUELLE al armar la carga (corrección de
     * Ariel, 18/09): caja no sabe con qué tipo de pallet va a salir ni qué racks
     * se van a usar, así que el borrador no los trae.
     */
    envases:       EnvasesCarga
    kg?:           number
    /** Talonario vigente (config/cot.respaldo) si la app numera el remito R. */
    remitoR?:      { puntoVenta: number; cai: string; vencimiento: string }
    /** Si la carga final requiere COT, la hora real de salida es AHORA. */
    pideCot:       boolean
  },
  actor: ActorMuelleEmite,
): Promise<RemitoCarga> {
  const items = aplicarCorrecciones(borrador.items, opciones.correcciones ?? [])
  const correccionesMuelle = diferenciasContraElPlan(borrador.items, items)
  const envases = opciones.envases
  const ahora = new Date()

  const remitoRef = doc(collection(db, REMITOS))
  const borradorRef = doc(db, 'borradoresCarga', borrador.id)

  const data = await runTransaction(db, async (tx) => {
    // El borrador se relee dentro de la transacción: si otro muellero lo aceptó
    // mientras este miraba la pantalla, el camión no puede salir dos veces.
    const bSnap = await tx.get(borradorRef)
    if (!bSnap.exists()) throw new BorradorNoDisponibleError('Ese borrador ya no existe.')
    const estado = bSnap.data().estado as BorradorCarga['estado']
    if (estado === 'aceptado') throw new BorradorNoDisponibleError('Otro compañero ya entregó este camión.')

    const counterSnap = await tx.get(COUNTER_REF(actor.plantaId))
    const numero = counterSnap.exists() ? (counterSnap.data().next as number) : 1

    let remitoR: RemitoCarga['remitoR'] | undefined
    if (opciones.remitoR) {
      const rSnap = await tx.get(REMITO_R_COUNTER_REF())
      if (!rSnap.exists()) throw new TalonarioRemitoCargaNoInicializadoError('El talonario del remito R de carga no está inicializado (Ajustes → COT de ARBA → próximo número).')
      const numeroR = Number(rSnap.data().next)
      const ultimoR = rSnap.data().ultimo != null ? Number(rSnap.data().ultimo) : null
      if (ultimoR !== null && numeroR > ultimoR) throw new TalonarioRemitoCargaNoInicializadoError(`El talonario del remito R de carga se agotó (último número autorizado por el CAI: ${ultimoR}). Hay que pedir un CAI nuevo y cargarlo en Ajustes → COT de ARBA.`)
      tx.update(REMITO_R_COUNTER_REF(), { next: numeroR + 1 })
      remitoR = { puntoVenta: opciones.remitoR.puntoVenta, numero: numeroR, cai: opciones.remitoR.cai, vencimiento: opciones.remitoR.vencimiento }
    }
    tx.set(COUNTER_REF(actor.plantaId), { next: numero + 1 })

    // La solicitud de COT se completa acá con lo único que el borrador no podía
    // saber: la hora real del traslado y el número del remito R que lo respalda.
    const cotSolicitud: CotSolicitud | undefined = opciones.pideCot
      ? {
          ...borrador.cotDestino,
          respaldo: {
            ...borrador.cotDestino.respaldo,
            prefijo: remitoR?.puntoVenta ?? borrador.cotDestino.respaldo.prefijo,
            numero:  remitoR?.numero ?? 0,
          },
          fechaSalida: claveDia(ahora),
          horaSalida:  `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`,
        }
      : undefined

    const remito: Omit<RemitoCarga, 'id'> = {
      numero,
      codigo:       codigoRemitoCarga(actor.plantaId, numero),
      plantaId:     actor.plantaId,
      camionId:     borrador.camionId,
      camionLabel:  borrador.camionLabel,
      choferId:     borrador.choferId,
      choferNombre: borrador.choferNombre,
      ...(borrador.depositoTango ? { depositoTango: borrador.depositoTango, depositoTangoNombre: borrador.depositoTangoNombre ?? '' } : {}),
      items,
      palletsCarga: envases.tarimasMadera + envases.palletsMetal,
      envases:      { tarimasMadera: envases.tarimasMadera, palletsMetal: envases.palletsMetal, racks: [...envases.racks] },
      // Nace EMITIDO: confeccionar el remito y entregar el camión son dos actos
      // distintos (corrección de Ariel, 18/09). Este papel es contra el que se
      // carga y el que mira seguridad; la entrega se marca después, con la
      // mercadería ya arriba del camión.
      estado:       'emitido',
      creadoPor:    borrador.creadoPor,
      emitidoPor:   { uid: actor.uid, nombre: actor.nombre },
      borradorId:   borrador.id,
      ...(correccionesMuelle.length ? { correccionesMuelle } : {}),
      fecha:        Timestamp.now(),
      tango:        { estado: 'pendiente' },
      ...(opciones.kg !== undefined ? { kg: opciones.kg } : {}),
      ...(cotSolicitud ? { cotSolicitud } : {}),
      ...(remitoR ? { remitoR } : {}),
    }
    tx.set(remitoRef, remito)
    tx.update(borradorRef, { estado: 'aceptado', remitoId: remitoRef.id })
    return remito
  })
  return { id: remitoRef.id, ...data }
}

export class BorradorNoDisponibleError extends Error {}

/** Las cantidades del borrador con lo que muelle corrigió encima. Un 0 saca el renglón. */
export function aplicarCorrecciones(items: RemitoCargaItem[], correcciones: CorreccionMuelle[]): RemitoCargaItem[] {
  if (!correcciones.length) return items
  const porId = new Map(correcciones.map((c) => [c.productoId, c.cantidad]))
  return items
    .map((i) => (porId.has(i.productoId) ? { ...i, cantidad: porId.get(i.productoId)! } : i))
    .filter((i) => i.cantidad > 0)
}

/** Qué renglones difieren del plan, para poder medir después cuántos remitos salen corregidos. */
export function diferenciasContraElPlan(
  plan: RemitoCargaItem[],
  real: RemitoCargaItem[],
): NonNullable<RemitoCarga['correccionesMuelle']> {
  const realPorId = new Map(real.map((i) => [i.productoId, i.cantidad]))
  const out: NonNullable<RemitoCarga['correccionesMuelle']> = []
  for (const i of plan) {
    const cargado = realPorId.get(i.productoId) ?? 0
    if (cargado !== i.cantidad) out.push({ productoId: i.productoId, nombre: i.nombre, planificado: i.cantidad, cargado })
  }
  // Un producto que muelle sumó y no estaba en el plan también es una corrección.
  const planIds = new Set(plan.map((i) => i.productoId))
  for (const i of real) {
    if (!planIds.has(i.productoId)) out.push({ productoId: i.productoId, nombre: i.nombre, planificado: 0, cargado: i.cantidad })
  }
  return out
}

// Muelle asigna (o cambia) la dársena donde carga el camión — el tablero de
// TV agrupa por este campo. Solo mientras el remito sigue 'emitido'.
export const asignarDarsena = (
  remito: RemitoCarga,
  darsena: number,
): Promise<void> =>
  // La hora va sola: es el mismo toque, no un dato más que pedirle al muelle
  // (2026-09-13, métricas de tiempos). Si se cambia de dársena, vale la última.
  updateDoc(doc(db, REMITOS, remito.id), { darsena, darsenaAsignadaEn: Timestamp.now() })

// Seguridad controla el camión cargado en el portón y libera la salida.
// Solo la transición entregado → salido — reglas con hasOnly.
export const marcarSalidaRemito = async (
  remito: RemitoCarga,
  actor: { uid: string; nombre: string },
): Promise<void> => {
  // Sin señal el write queda encolado; el portón no puede quedar trabado en
  // un spinner con el camión esperando.
  await esperarOEncolar(
    updateDoc(doc(db, REMITOS, remito.id), {
      estado: 'salido',
      salida: { uid: actor.uid, nombre: actor.nombre, hora: Timestamp.now() },
    }),
    { origen: 'marcarSalidaRemito', remitoId: remito.id },
  )
}

/**
 * El camión volvió a planta. Lo marca seguridad en el portón (ve entrar el
 * camión) o el propio chofer desde su teléfono: el primero que toque gana, y el
 * segundo no puede pisarlo (las reglas exigen que `regreso` no exista todavía).
 *
 * No toca `estado`: el remito sigue 'salido' hasta que caja liquide. Es solo el
 * sello de hora que enciende "VOLVIERON — FALTA CONTAR" en el TV del muelle.
 */
export const marcarRegresoRemito = async (
  remito: RemitoCarga,
  actor: { uid: string; nombre: string },
): Promise<void> => {
  // El camión llega a planta con señal mala y el portón no puede quedar trabado
  // en un spinner: si no sube en 4 s, queda encolado y se manda solo.
  await esperarOEncolar(
    updateDoc(doc(db, REMITOS, remito.id), {
      regreso: { uid: actor.uid, nombre: actor.nombre, hora: Timestamp.now() },
    }),
    { origen: 'marcarRegresoRemito', remitoId: remito.id },
  )
}

/**
 * El chofer que volvió dice en qué dársena estacionó (2026-09-15). Una sola vez,
 * sobre un regreso ya marcado (por él o por seguridad) y sin dársena: las reglas
 * rechazan cambiarla. Qué bocas están libres lo dice `muelleEstado/{planta}`.
 */
export const elegirDarsenaRegreso = async (remito: RemitoCarga, darsena: number): Promise<void> => {
  await esperarOEncolar(
    updateDoc(doc(db, REMITOS, remito.id), { 'regreso.darsena': darsena }),
    { origen: 'elegirDarsenaRegreso', remitoId: remito.id },
  )
}

const rangoDia = (dia: Date): [Timestamp, Timestamp] => {
  const desde = new Date(dia); desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
  return [Timestamp.fromDate(desde), Timestamp.fromDate(hasta)]
}

// Remitos del día de una planta (listado de la pantalla de caja).
export const subscribeRemitosCargaDelDia = (
  plantaId: PlantaId,
  dia: Date,
  callback: (remitos: RemitoCarga[]) => void,
): () => void => {
  const [desde, hasta] = rangoDia(dia)
  return onSnapshot(
    query(
      collection(db, REMITOS),
      where('plantaId', '==', plantaId),
      where('fecha', '>=', desde),
      where('fecha', '<', hasta),
    ),
    (snap) => callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as RemitoCarga))
        .sort((a, b) => b.numero - a.numero),
    ),
    onSnapshotError(callback, 'remitosCarga'),
  )
}

// Remitos de carga de HOY de un chofer ("Mi carga de hoy" en su hub; además es
// la fuente del camión del día — users/{uid}.camionId no lo escribe ninguna UI).
export const subscribeRemitosCargaChoferHoy = (
  choferId: string,
  callback: (remitos: RemitoCarga[]) => void,
): () => void => {
  const [desde, hasta] = rangoDia(new Date())
  return onSnapshot(
    query(
      collection(db, REMITOS),
      where('choferId', '==', choferId),
      where('fecha', '>=', desde),
      where('fecha', '<', hasta),
    ),
    (snap) => callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as RemitoCarga))
        .sort((a, b) => b.numero - a.numero),
    ),
    onSnapshotError(callback, 'remitosCarga'),
  )
}

/**
 * Espera a que el trigger del COT escriba la respuesta de ARBA en el remito
 * (2026-09-16: caja imprimía el remito R en el mismo instante de crearlo y el
 * papel salía sin COT aunque ARBA lo diera segundos después). Resuelve con el
 * remito actualizado en cuanto el COT queda `presentado` o `error`, o con lo
 * último visto al vencer el plazo; nunca rechaza.
 */
export function esperarCotRemito(id: string, timeoutMs = 25_000): Promise<RemitoCarga | null> {
  return new Promise((resolve) => {
    let ultimo: RemitoCarga | null = null
    let listo = false
    const terminar = (r: RemitoCarga | null) => { if (listo) return; listo = true; clearTimeout(timer); off(); resolve(r) }
    const timer = setTimeout(() => terminar(ultimo), timeoutMs)
    const off = onSnapshot(
      doc(db, REMITOS, id),
      (snap) => {
        if (!snap.exists()) return
        ultimo = { id: snap.id, ...snap.data() } as RemitoCarga
        const e = ultimo.cot?.estado
        if (e === 'presentado' || e === 'error') terminar(ultimo)
      },
      () => terminar(ultimo),
    )
  })
}
