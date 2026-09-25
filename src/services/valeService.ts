import {
  collection, doc, documentId, getDocs, onSnapshot, orderBy, query, runTransaction, Timestamp, where,
} from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { codigoVale, contadorVale, topeVale, valeId } from '@/utils/sobres'
import type { ActorSobre, CajaSesion, EmpresaTango, FormaCierreVale, ReceptorVale, SobrePorEmpresa, ValeCaja } from '@/types'

// Vales de caja (2026-09-25). Ver el tipo `ValeCaja` en types.ts. Caja lo emite
// desde su turno abierto; el cierre del turno le anota el sobre en el que viajó
// (sobreService.cerrarTurnoYRendir); tesorería lo tilda al contar el sobre
// (sobreService.recibirSobre) y lo cierra desde Recepción (cerrarVale).

const VALES = 'valesCaja'
const SESIONES = 'cajaSesiones'
/** Más de esto en un turno no es un cajero dando vales, es un bug. */
const MAX_VALES_POR_TURNO = 50

const aVale = (id: string, d: Record<string, unknown>): ValeCaja => ({ id, ...d }) as ValeCaja

export interface DatosVale {
  sesion:   CajaSesion
  importe:  number
  empresa:  EmpresaTango
  /** El cajón por empresa AHORA: lo que físicamente hay para dar. */
  porEmpresa: SobrePorEmpresa | undefined
  receptor: ReceptorVale
  motivo:   string
  firmaRecibe:    string
  firmanteRecibe: string
}

const NOMBRE: Record<EmpresaTango, string> = { redonhielo: 'Redonhielo', rolito: 'Rolito' }

export async function crearVale(datos: DatosVale, actor: ActorSobre): Promise<ValeCaja> {
  const importe = Math.round(datos.importe * 100) / 100
  if (!(importe > 0)) throw new Error('El vale tiene que ser mayor a cero.')
  const tope = topeVale(datos.porEmpresa, datos.empresa)
  if (importe > tope + 0.005) throw new Error(`En la caja hay ${tope.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })} de ${NOMBRE[datos.empresa]}: el vale no puede pasar de eso.`)
  const nombre = datos.receptor.nombre.trim()
  if (!nombre) throw new Error('Poné el nombre de quien recibe el vale.')
  const motivo = datos.motivo.trim()
  if (!motivo) throw new Error('Escribí el motivo del vale.')
  if (!datos.firmaRecibe) throw new Error('Falta la firma de quien recibe el vale.')
  const { sesion } = datos
  const sesionRef  = doc(db, SESIONES, sesion.id)
  const counterRef = doc(db, 'config', contadorVale(sesion.plantaId))

  return runTransaction(db, async (tx) => {
    const sesionSnap = await tx.get(sesionRef)
    if (!sesionSnap.exists() || sesionSnap.data().estado !== 'abierta') throw new Error('El turno ya está cerrado: no se puede dar un vale.')
    let k = 1
    for (; k <= MAX_VALES_POR_TURNO; k++) {
      const s = await tx.get(doc(db, VALES, valeId(sesion.id, k)))
      if (!s.exists()) break
    }
    if (k > MAX_VALES_POR_TURNO) throw new Error('Demasiados vales en este turno. Cerrá el turno.')
    const counterSnap = await tx.get(counterRef)
    const numero = counterSnap.exists() ? (counterSnap.data().next as number) : 1
    const ahora = Timestamp.now()
    const id = valeId(sesion.id, k)
    const receptor: ReceptorVale = { nombre, ...(datos.receptor.uid ? { uid: datos.receptor.uid } : {}), ...(datos.receptor.dni?.trim() ? { dni: datos.receptor.dni.trim() } : {}) }
    const vale: Omit<ValeCaja, 'id'> = {
      plantaId: sesion.plantaId, fecha: sesion.fecha, numero, codigo: codigoVale(numero, sesion.plantaId),
      cajaSesionId: sesion.id, emitio: actor, empresa: datos.empresa, importe, receptor, motivo,
      firmaRecibe: datos.firmaRecibe, firmanteRecibe: datos.firmanteRecibe.trim() || nombre,
      emitidoEn: ahora, estado: 'abierto', createdAt: ahora,
    }
    tx.set(counterRef, { next: numero + 1 })
    tx.set(doc(db, VALES, id), vale)
    return { id, ...vale }
  })
}

/** Tesorería cierra el vale: con el comprobante del gasto, descuento de sueldo o devolución de la plata. */
export async function cerrarVale(id: string, datos: { forma: FormaCierreVale; nota: string }, actor: ActorSobre): Promise<void> {
  const ref = doc(db, VALES, id)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('El vale no existe.')
    if (snap.data().estado === 'cerrado') throw new Error('Ese vale ya está cerrado.')
    tx.update(ref, { estado: 'cerrado', cierre: { forma: datos.forma, nota: datos.nota.trim(), por: actor, en: Timestamp.now() } })
  })
}

/** Los vales de un turno (los de caja, en vivo). */
export const subscribeValesDeTurno = (cajaSesionId: string, cb: (v: ValeCaja[]) => void): () => void =>
  onSnapshot(
    query(collection(db, VALES), where('cajaSesionId', '==', cajaSesionId)),
    (snap) => cb(snap.docs.map((d) => aVale(d.id, d.data())).sort((a, b) => a.emitidoEn.toMillis() - b.emitidoEn.toMillis())),
    (err) => { reportError(err, { subscription: 'vales-turno', cajaSesionId }); cb([]) },
  )

/** Los vales de un día (todas las plantas): para la tira de tesorería. */
export const subscribeValesDelDia = (fecha: string, cb: (v: ValeCaja[]) => void): () => void =>
  onSnapshot(
    query(collection(db, VALES), where('fecha', '==', fecha)),
    (snap) => cb(snap.docs.map((d) => aVale(d.id, d.data()))),
    (err) => { reportError(err, { subscription: 'vales-dia', fecha }); cb([]) },
  )

/** Los vales abiertos de cualquier fecha: lo que tesorería tiene que cerrar. */
export const subscribeValesAbiertos = (cb: (v: ValeCaja[]) => void): () => void =>
  onSnapshot(
    query(collection(db, VALES), where('estado', '==', 'abierto'), orderBy('emitidoEn', 'asc')),
    (snap) => cb(snap.docs.map((d) => aVale(d.id, d.data()))),
    (err) => { reportError(err, { subscription: 'vales-abiertos' }); cb([]) },
  )

/** Vales por id (de a 10, tope de `in`). */
export async function getVales(ids: string[]): Promise<ValeCaja[]> {
  const out: ValeCaja[] = []
  for (let i = 0; i < ids.length; i += 10) {
    const snap = await getDocs(query(collection(db, VALES), where(documentId(), 'in', ids.slice(i, i + 10))))
    out.push(...snap.docs.map((d) => aVale(d.id, d.data())))
  }
  return out
}
