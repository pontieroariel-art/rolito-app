import { collection, doc, getDocs, onSnapshot, query, runTransaction, where, Timestamp } from 'firebase/firestore'
import type { DocumentData } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { addDaysStr } from '@/utils/helpers'
import {
  anticipoId, codigoSobre, conformidadDe, contadorDeSobre, diferenciaDeclarada, diferenciaRecepcion, fajosDe, hayDiferencia,
  recibidosSinMotivo, sobreId, topeAnticipo, valoresSinDecidir,
} from '@/utils/sobres'
import type {
  ActorSobre, CajaSesion, EmpresaTango, MotivoDiferenciaLiquidacion, PlantaId, RindeA, Sobre, SobreDeclarado, SobrePorEmpresa, SobreRecepcion,
  SobreSistema, ValorDeclarado, ValorRecibido,
} from '@/types'

// El sobre (2026-09-14, rendición de fondos): un documento inmutable en
// `rendiciones` que nace cuando alguien cierra su conteo (arqueo ciego + firma)
// y se completa UNA sola vez cuando el receptor cuenta y firma. Fase 1: sobre
// de ventanilla → tesorería; el cierre del turno y el sobre salen en la misma
// transacción, con el número correlativo por planta. Las validaciones de acá
// duplican a propósito las de las reglas: la pantalla necesita un mensaje, no
// un "permission-denied".
//
// OJO: `rendiciones` también tiene los cierres viejos (`tipo: 'mostrador'`,
// interfaz `Rendicion`, sin `estado`). Toda lectura de sobres los descarta.

const RENDICIONES = 'rendiciones'
const SESIONES    = 'cajaSesiones'
const TIPOS_SOBRE = new Set(['ventanilla', 'cobrador', 'chofer', 'anticipo'])

export class SobreYaExisteError extends Error {
  constructor() { super('Este turno ya está cerrado: el sobre ya existe. Actualizá la pantalla.') }
}
export class SobreYaRecibidoError extends Error {
  constructor() { super('Este sobre ya fue recibido. Actualizá la pantalla.') }
}

const esSobre = (d: DocumentData): boolean => typeof d.estado === 'string' && TIPOS_SOBRE.has(d.tipo as string)
const aSobre  = (id: string, d: DocumentData): Sobre => ({ id, ...d }) as Sobre

// ── Cierre del turno (quien rinde) ───────────────────────────────────────────

export interface DatosCierreTurno {
  sesion:    CajaSesion
  /** Ya calculado por la pantalla con `sistemaVentanilla()`. */
  sistema:   SobreSistema
  declarado: SobreDeclarado
  motivoDiferencia?: { motivo: MotivoDiferenciaLiquidacion; nota: string }
  firmaRinde:    string
  firmanteRinde: string
}

/**
 * Cierra el turno y crea el sobre de ventanilla en UNA transacción: toma el
 * número, escribe el sobre `pendiente_recepcion` con custodia del cajero y
 * pasa la sesión a `cerrada` con su `rendicionId`. La diferencia declarada se
 * calcula acá (declarado contra sistema); si la hay, el motivo con nota es
 * obligatorio; si no la hay, no se guarda aunque venga.
 */
export async function cerrarTurnoYRendir(datos: DatosCierreTurno, actor: ActorSobre): Promise<Sobre> {
  const { sesion, sistema } = datos
  const sinDecidir = valoresSinDecidir(sistema, [...datos.declarado.cheques, ...datos.declarado.retenciones])
  if (sinDecidir.length > 0) throw new Error(`Faltan tildar ${sinDecidir.length} valor(es) en papel antes de firmar.`)
  if (!datos.firmaRinde) throw new Error('Falta la firma de quien rinde.')
  const diferencia = diferenciaDeclarada(sistema, datos.declarado)
  const motivoDiferencia = motivoSiHayDiferencia(diferencia, datos.motivoDiferencia)

  const id         = sobreId('ventanilla', sesion.fecha, sesion.cajero.uid, sesion.numero)
  const sobreRef   = doc(db, RENDICIONES, id)
  const sesionRef  = doc(db, SESIONES, sesion.id)
  const counterRef = doc(db, 'config', contadorDeSobre('ventanilla', { plantaId: sesion.plantaId }))

  const data = await runTransaction(db, async (tx) => {
    const [existente, sesionSnap, counterSnap] = await Promise.all([tx.get(sobreRef), tx.get(sesionRef), tx.get(counterRef)])
    if (existente.exists()) throw new SobreYaExisteError()
    if (!sesionSnap.exists() || sesionSnap.data().estado !== 'abierta') throw new SobreYaExisteError()
    const numero = counterSnap.exists() ? (counterSnap.data().next as number) : 1
    const ahora  = Timestamp.now()
    const sobre: Omit<Sobre, 'id'> = {
      tipo:      'ventanilla',
      rindeA:    'tesoreria',
      plantaId:  sesion.plantaId,
      fecha:     sesion.fecha,
      numero,
      codigo:    codigoSobre('ventanilla', numero, { plantaId: sesion.plantaId }),
      rindio:    actor,
      cajaSesionId: sesion.id,
      sistema,
      declarado: limpiarDeclarado(datos.declarado),
      diferenciaDeclarada: diferencia,
      ...(motivoDiferencia ? { motivoDiferencia } : {}),
      firmaRinde:    datos.firmaRinde,
      firmanteRinde: datos.firmanteRinde,
      // Reparto en dos fajos de lo contado (2026-09-16): Rolito exacto, Redonhielo el resto.
      fajos:     fajosDe(sistema.porEmpresa, datos.declarado.efectivo),
      cerradaEn: ahora,
      estado:    'pendiente_recepcion',
      custodia:  { ...actor, desde: ahora },
      createdAt: ahora,
    }
    tx.set(counterRef, { next: numero + 1 })
    tx.set(sobreRef, sobre)
    tx.update(sesionRef, { estado: 'cerrada', cerradaEn: ahora, rendicionId: id })
    return sobre
  })
  return { id, ...data }
}

// ── Anticipo a tesorería (2026-09-23) ────────────────────────────────────────

export interface DatosAnticipo {
  sesion:  CajaSesion
  monto:   number
  empresa: EmpresaTango
  /** El cajón por empresa AHORA (neto de anticipos anteriores): el tope del anticipo. */
  porEmpresa: SobrePorEmpresa | undefined
  recibio:        ActorSobre
  firmaRecibe:    string
  firmanteRecibe: string
}

/** Más de esto en un turno no es un cajero anticipando, es un bug. */
const MAX_ANTICIPOS_POR_TURNO = 20

/**
 * Caja le entrega plata a tesorería ANTES de cerrar el turno (un vale). Es un
 * sobre chico que nace `entregada`, con la firma de quien lo recibe en la
 * tablet del cajero y la custodia ya de esa persona; tesorería lo cuenta y
 * confirma como a cualquier sobre. Descuenta del cajón de su empresa
 * (`sistemaVentanilla` lo resta) y no puede superar lo que hay de esa empresa.
 */
export async function crearAnticipo(datos: DatosAnticipo, actor: ActorSobre): Promise<Sobre> {
  const monto = Math.round(datos.monto * 100) / 100
  if (!(monto > 0)) throw new Error('El anticipo tiene que ser mayor a cero.')
  const tope = topeAnticipo(datos.porEmpresa, datos.empresa)
  if (monto > tope + 0.005) throw new Error(`En el cajón hay ${tope.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })} de ${datos.empresa === 'rolito' ? 'Rolito' : 'Redonhielo'}: el anticipo no puede pasar de eso.`)
  if (!datos.firmaRecibe) throw new Error('Falta la firma de quien recibe el anticipo.')
  if (datos.recibio.uid === actor.uid) throw new Error('El anticipo lo tiene que recibir alguien de tesorería, no vos.')
  const { sesion } = datos
  const sesionRef  = doc(db, SESIONES, sesion.id)
  const counterRef = doc(db, 'config', contadorDeSobre('anticipo', { plantaId: sesion.plantaId }))

  return runTransaction(db, async (tx) => {
    const sesionSnap = await tx.get(sesionRef)
    if (!sesionSnap.exists() || sesionSnap.data().estado !== 'abierta') throw new Error('El turno ya está cerrado: no se puede anticipar.')
    // El k-ésimo anticipo del turno: ids determinísticos, se recorren en la transacción.
    let k = 1
    for (; k <= MAX_ANTICIPOS_POR_TURNO; k++) {
      const s = await tx.get(doc(db, RENDICIONES, anticipoId(sesion.id, k)))
      if (!s.exists()) break
    }
    if (k > MAX_ANTICIPOS_POR_TURNO) throw new Error('Demasiados anticipos en este turno. Cerrá el turno.')
    const counterSnap = await tx.get(counterRef)
    const numero = counterSnap.exists() ? (counterSnap.data().next as number) : 1
    const ahora  = Timestamp.now()
    const id = anticipoId(sesion.id, k)
    const vacio = { ventasIds: [], cobranzasIds: [], liquidacionesIds: [], sobresRecibidosIds: [] }
    const sobre: Omit<Sobre, 'id'> = {
      tipo:      'anticipo',
      rindeA:    'tesoreria',
      plantaId:  sesion.plantaId,
      fecha:     sesion.fecha,
      numero,
      codigo:    codigoSobre('anticipo', numero, { plantaId: sesion.plantaId }),
      rindio:    actor,
      cajaSesionId: sesion.id,
      anticipo:  { empresa: datos.empresa },
      sistema:   { efectivo: monto, cheques: [], retenciones: [], transferencias: { cantidad: 0, total: 0 }, origenIds: vacio },
      declarado: { efectivo: monto, cheques: [], retenciones: [] },
      diferenciaDeclarada: { efectivo: 0, valoresFaltantes: { cantidad: 0, total: 0 } },
      firmaRinde:    '',
      firmanteRinde: actor.nombre,
      fajos:     datos.empresa === 'rolito' ? { redonhielo: 0, rolito: monto } : { redonhielo: monto, rolito: 0 },
      cerradaEn: ahora,
      estado:    'entregada',
      custodia:  { ...datos.recibio, desde: ahora },
      entrega:   { recibio: datos.recibio, en: ahora, firmaRecibe: datos.firmaRecibe, firmanteRecibe: datos.firmanteRecibe.trim() || datos.recibio.nombre },
      createdAt: ahora,
    }
    tx.set(counterRef, { next: numero + 1 })
    tx.set(doc(db, RENDICIONES, id), sobre)
    return { id, ...sobre }
  })
}

// ── Entrega en mano (el cajero se lo da a tesorería) ─────────────────────────

export interface DatosEntregaSobre {
  recibio:        ActorSobre
  firmaRecibe:    string
  firmanteRecibe: string
}

export class SobreYaEntregadoError extends Error {
  constructor() { super('Este sobre ya fue entregado. Actualizá la pantalla.') }
}

/**
 * El cajero entrega el sobre cerrado en mano (2026-09-16): elige a quién de
 * tesorería y esa persona firma en su tablet. Pasa a 'entregada' y la custodia
 * a quien recibió. Escribe solo `estado`, `custodia` y `entrega`; las reglas
 * exigen que sea el propio cajero y que quien recibe sea de tesorería.
 */
export async function entregarSobre(sobreId: string, datos: DatosEntregaSobre): Promise<Sobre> {
  if (!datos.firmaRecibe) throw new Error('Falta la firma de quien recibe el sobre.')
  const ref = doc(db, RENDICIONES, sobreId)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists() || !esSobre(snap.data())) throw new Error('El sobre no existe.')
    const sobre = aSobre(snap.id, snap.data())
    if (sobre.estado !== 'pendiente_recepcion') throw new SobreYaEntregadoError()
    const ahora = Timestamp.now()
    const entrega = { recibio: datos.recibio, en: ahora, firmaRecibe: datos.firmaRecibe, firmanteRecibe: datos.firmanteRecibe.trim() }
    const custodia = { ...datos.recibio, desde: ahora }
    tx.update(ref, { estado: 'entregada', custodia, entrega })
    return { ...sobre, estado: 'entregada', custodia, entrega }
  })
}

// ── Recepción (quien recibe) ─────────────────────────────────────────────────

export interface DatosRecepcion {
  efectivoContado: number
  /** Contado por fajo (2026-09-23): Redonhielo y Rolito; su suma es `efectivoContado`. */
  fajos?:      Record<EmpresaTango, number>
  cheques:     ValorRecibido[]
  retenciones: ValorRecibido[]
  /** Obligatorios si hay diferencia (se valida acá también). */
  motivo?: MotivoDiferenciaLiquidacion
  nota?:   string
  firmaRecibe:    string
  firmanteRecibe: string
}

/**
 * Tesorería (o caja, en las fases siguientes) recibe el sobre: relee el doc en
 * la transacción, exige que siga pendiente, calcula la diferencia contra el
 * SISTEMA (no contra lo declarado) y la conformidad, y escribe solo
 * `estado`, `custodia` y `recepcion` (lo único que las reglas dejan tocar).
 */
export async function recibirSobre(sobreId: string, datos: DatosRecepcion, actor: ActorSobre): Promise<Sobre> {
  const valores = [...datos.cheques, ...datos.retenciones]
  const sinMotivo = recibidosSinMotivo(valores)
  if (sinMotivo.length > 0) throw new Error(`Hay ${sinMotivo.length} valor(es) marcados como no recibidos sin motivo.`)
  if (!datos.firmaRecibe) throw new Error('Falta la firma de quien recibe.')

  const ref = doc(db, RENDICIONES, sobreId)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists() || !esSobre(snap.data())) throw new Error('El sobre no existe.')
    const sobre = aSobre(snap.id, snap.data())
    if (sobre.estado === 'recibida') throw new SobreYaRecibidoError()
    const sinDecidir = valoresSinDecidir(sobre.sistema, valores)
    if (sinDecidir.length > 0) throw new Error(`Faltan tildar ${sinDecidir.length} valor(es) en papel antes de firmar.`)

    const dif = diferenciaRecepcion(sobre.sistema, datos)
    const conformidad = conformidadDe(dif)
    const motivo = conformidad === 'con_diferencia' ? motivoSiHayDiferencia(dif, datos.motivo ? { motivo: datos.motivo, nota: datos.nota ?? '' } : undefined) : undefined
    const ahora = Timestamp.now()
    const recepcion: SobreRecepcion = {
      recibio:         actor,
      en:              ahora,
      efectivoContado: datos.efectivoContado,
      ...(datos.fajos ? { fajos: datos.fajos } : {}),
      cheques:         datos.cheques.map(limpiarRecibido),
      retenciones:     datos.retenciones.map(limpiarRecibido),
      conformidad,
      ...(motivo ? { diferencia: { ...dif, ...motivo } } : {}),
      firmaRecibe:     datos.firmaRecibe,
      firmanteRecibe:  datos.firmanteRecibe,
    }
    const custodia = { ...actor, desde: ahora }
    tx.update(ref, { estado: 'recibida', custodia, recepcion })
    return { ...sobre, estado: 'recibida', custodia, recepcion }
  })
}

// ── Lecturas ─────────────────────────────────────────────────────────────────

/**
 * Bandeja "Por recibir": sobres pendientes que rinden a X (tesorería o caja),
 * opcionalmente de una planta. Solo igualdades (sin índice compuesto); los
 * cierres viejos no tienen `estado`, así que no entran. El más viejo primero.
 */
export const subscribeSobresPendientes = (
  plantaId: PlantaId | undefined,
  rindeA: RindeA,
  cb: (s: Sobre[]) => void,
  alFallar?: (err: Error) => void,
): () => void =>
  onSnapshot(
    query(
      collection(db, RENDICIONES),
      where('estado', 'in', ['pendiente_recepcion', 'entregada']),
      where('rindeA', '==', rindeA),
      ...(plantaId ? [where('plantaId', '==', plantaId)] : []),
    ),
    (snap) => cb(snap.docs.filter((d) => esSobre(d.data())).map((d) => aSobre(d.id, d.data())).sort(porCerradaEn)),
    (err) => { reportError(err, { subscription: 'sobres-pendientes', plantaId, rindeA }); cb([]); alFallar?.(err) },
  )

/** Todos los sobres del día de una planta (tablero de custodia). El tipo se filtra en cliente para no pedir índice. */
export const subscribeSobresDelDia = (
  plantaId: PlantaId,
  fecha: string,
  cb: (s: Sobre[]) => void,
  alFallar?: (err: Error) => void,
): () => void =>
  onSnapshot(
    query(collection(db, RENDICIONES), where('fecha', '==', fecha), where('plantaId', '==', plantaId)),
    (snap) => cb(snap.docs.filter((d) => esSobre(d.data())).map((d) => aSobre(d.id, d.data())).sort(porCerradaEn)),
    (err) => { reportError(err, { subscription: 'sobres-dia', plantaId, fecha }); cb([]); alFallar?.(err) },
  )

/** Los sobres que rindió una persona con fecha en [desde, hasta). Índice `rendiciones (rindio.uid ASC, fecha ASC)`. */
export const subscribeSobresDe = (
  uid: string,
  desde: string,
  hasta: string,
  cb: (s: Sobre[]) => void,
  alFallar?: (err: Error) => void,
): () => void =>
  onSnapshot(
    query(collection(db, RENDICIONES), where('rindio.uid', '==', uid), where('fecha', '>=', desde), where('fecha', '<', hasta)),
    (snap) => cb(snap.docs.filter((d) => esSobre(d.data())).map((d) => aSobre(d.id, d.data())).sort(porCerradaEnDesc)),
    (err) => { reportError(err, { subscription: 'sobres-de', uid, desde, hasta }); cb([]); alFallar?.(err) },
  )

/**
 * Los sobres que tesorería CONTÓ en un día (por la hora de la recepción, no por la
 * fecha del sobre, 2026-09-23): el de ayer recibido hoy tiene que aparecer en
 * "Recibidos hoy" y no desaparecer al contarlo. Rango sobre un solo campo anidado.
 */
export const subscribeSobresRecibidosEn = (
  fecha: string,
  cb: (s: Sobre[]) => void,
  alFallar?: (err: Error) => void,
): () => void => {
  const desde = Timestamp.fromDate(new Date(`${fecha}T00:00:00`))
  const hasta = Timestamp.fromDate(new Date(`${addDaysStr(fecha, 1)}T00:00:00`))
  return onSnapshot(
    query(collection(db, RENDICIONES), where('recepcion.en', '>=', desde), where('recepcion.en', '<', hasta)),
    (snap) => cb(snap.docs.filter((d) => esSobre(d.data())).map((d) => aSobre(d.id, d.data())).sort(porCerradaEn)),
    (err) => { reportError(err, { subscription: 'sobres-recibidos-en', fecha }); cb([]); alFallar?.(err) },
  )
}

/** Un sobre en vivo (quien rindió mira si ya lo recibieron). Un doc viejo de `rendiciones` cuenta como inexistente. */
export const subscribeSobre = (
  id: string,
  cb: (s: Sobre | null) => void,
  alFallar?: (err: Error) => void,
): () => void =>
  onSnapshot(
    doc(db, RENDICIONES, id),
    (snap) => cb(snap.exists() && esSobre(snap.data()) ? aSobre(snap.id, snap.data()) : null),
    (err) => { reportError(err, { subscription: 'sobre', id }); cb(null); alFallar?.(err) },
  )

/** Historial de tesorería: sobres con fecha en [desde, hasta). Rango sobre un campo (sin índice); la planta se filtra en cliente. */
export async function getSobresEnRango(desde: string, hasta: string, plantaId?: PlantaId): Promise<Sobre[]> {
  const snap = await getDocs(query(collection(db, RENDICIONES), where('fecha', '>=', desde), where('fecha', '<', hasta)))
  return snap.docs
    .filter((d) => esSobre(d.data()) && (!plantaId || d.data().plantaId === plantaId))
    .map((d) => aSobre(d.id, d.data()))
    .sort(porCerradaEnDesc)
}

// ── Internos ─────────────────────────────────────────────────────────────────

/** Con diferencia, el motivo con nota es obligatorio; sin diferencia no se guarda nada. */
function motivoSiHayDiferencia(
  dif: { efectivo: number; valoresFaltantes: { cantidad: number; total: number } },
  motivo: { motivo: MotivoDiferenciaLiquidacion; nota: string } | undefined,
): { motivo: MotivoDiferenciaLiquidacion; nota: string } | undefined {
  if (!hayDiferencia(dif)) return undefined
  const nota = motivo?.nota.trim() ?? ''
  if (!motivo?.motivo || !nota) throw new Error('Hay diferencia: elegí el motivo y escribí una nota.')
  return { motivo: motivo.motivo, nota }
}

// Firestore rechaza `undefined`: las claves opcionales solo van si tienen valor.
const limpiarDeclarado = (d: SobreDeclarado): SobreDeclarado => {
  const observacion = d.observacion?.trim()
  return {
    efectivo:    d.efectivo,
    ...(d.conteoBilletes ? { conteoBilletes: d.conteoBilletes } : {}),
    cheques:     d.cheques.map(limpiarValorDeclarado),
    retenciones: d.retenciones.map(limpiarValorDeclarado),
    ...(observacion ? { observacion } : {}),
  }
}
const limpiarValorDeclarado = (v: ValorDeclarado): ValorDeclarado => ({ clave: v.clave, presente: v.presente, ...(!v.presente && v.motivo?.trim() ? { motivo: v.motivo.trim() } : {}) })
const limpiarRecibido = (v: ValorRecibido): ValorRecibido => {
  const motivo = v.motivoNoRecibido?.trim()
  return { clave: v.clave, recibido: v.recibido, ...(motivo ? { motivoNoRecibido: motivo } : {}) }
}

const porCerradaEn     = (a: Sobre, b: Sobre): number => a.cerradaEn.toMillis() - b.cerradaEn.toMillis()
const porCerradaEnDesc = (a: Sobre, b: Sobre): number => porCerradaEn(b, a)
