import { collection, doc, onSnapshot, orderBy, query, limit, setDoc, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { CicloRolitera, ParteMaquinas, PlantaId, TurnoProduccion } from '../types'
import { toDateStr } from '../utils/helpers'

// Parte de máquinas del maquinista — un doc por planta/día/turno, con id
// determinístico para que reabrir la pantalla (o quedarse sin wifi y volver)
// siga siempre sobre el mismo parte. Todas las escrituras son setDoc merge
// fire-and-forget: quedan encoladas por persistentLocalCache sin red, mismo
// criterio offline-first que crearPallet (produccionService.ts).
const PARTES = 'partesMaquinas'

export const parteMaquinasId = (plantaId: PlantaId, fecha: string, turno: TurnoProduccion): string =>
  `${plantaId}_${fecha}_${turno}`

export const fechaParteHoy = (): string => toDateStr(new Date())

// El doc base recién abierto no tiene ciclos/maquinarias/observaciones (se
// escriben con la primera estampa) — se normalizan acá y NUNCA en el merge de
// abrirParteMaquinas, porque un merge con `ciclos: []` pisaría lo ya cargado.
function normalizar(id: string, data: Record<string, unknown>): ParteMaquinas {
  return { ciclos: [], maquinarias: {}, observaciones: '', ...data, id } as unknown as ParteMaquinas
}

export const subscribeParteMaquinas = (
  plantaId: PlantaId, fecha: string, turno: TurnoProduccion,
  callback: (parte: ParteMaquinas | null) => void,
): (() => void) => {
  const id = parteMaquinasId(plantaId, fecha, turno)
  return onSnapshot(
    doc(db, PARTES, id),
    (snap) => callback(snap.exists() ? normalizar(snap.id, snap.data()) : null),
    () => callback(null),
  )
}

// Crea el doc base si no existe (merge: si ya existe no pisa lo cargado —
// p.ej. el turno noche que arrancó otro maquinista). El maquinista queda
// siempre el último que abrió el parte.
export function abrirParteMaquinas(
  plantaId: PlantaId, turno: TurnoProduccion,
  maquinista: { uid: string; nombre: string },
): void {
  const fecha = fechaParteHoy()
  const now = Timestamp.now()
  setDoc(doc(db, PARTES, parteMaquinasId(plantaId, fecha, turno)), {
    plantaId, fecha, turno, maquinista,
    createdAt: now, updatedAt: now,
  }, { merge: true })
}

// Estampa la hora actual en la rolitera: si su último ciclo está completo (o
// no tiene ninguno) arranca un ciclo nuevo con SALE; si quedó un SALE sin
// cerrar, le estampa el ENTRA. Devuelve qué estampó, para el feedback en UI.
export function estamparCiclo(parte: ParteMaquinas, rolitera: number): 'sale' | 'entra' {
  const now = Timestamp.now()
  const delRolitera = parte.ciclos.filter((c) => c.rolitera === rolitera)
  const ultimo = delRolitera[delRolitera.length - 1]

  let ciclos: CicloRolitera[]
  let estampado: 'sale' | 'entra'
  if (!ultimo || ultimo.entra) {
    ciclos = [...parte.ciclos, { rolitera, ciclo: delRolitera.length + 1, sale: now, entra: null }]
    estampado = 'sale'
  } else {
    ciclos = parte.ciclos.map((c) => (c === ultimo ? { ...c, entra: now } : c))
    estampado = 'entra'
  }

  setDoc(doc(db, PARTES, parte.id), { ciclos, updatedAt: now }, { merge: true })
  return estampado
}

// Deshace la última estampa de una rolitera (tocó el botón por error): borra
// el ENTRA del último ciclo, o el ciclo entero si solo tenía el SALE.
export function deshacerUltimaEstampa(parte: ParteMaquinas, rolitera: number): void {
  const delRolitera = parte.ciclos.filter((c) => c.rolitera === rolitera)
  const ultimo = delRolitera[delRolitera.length - 1]
  if (!ultimo) return

  const ciclos = ultimo.entra
    ? parte.ciclos.map((c) => (c === ultimo ? { ...c, entra: null } : c))
    : parte.ciclos.filter((c) => c !== ultimo)

  setDoc(doc(db, PARTES, parte.id), { ciclos, updatedAt: Timestamp.now() }, { merge: true })
}

export function toggleMaquinaria(parte: ParteMaquinas, maquinariaId: string, numero: number): void {
  const actual = parte.maquinarias?.[maquinariaId] ?? []
  const nueva = actual.includes(numero) ? actual.filter((n) => n !== numero) : [...actual, numero].sort()
  setDoc(doc(db, PARTES, parte.id), {
    maquinarias: { ...parte.maquinarias, [maquinariaId]: nueva },
    updatedAt: Timestamp.now(),
  }, { merge: true })
}

export function setObservacionesParte(parte: ParteMaquinas, observaciones: string): void {
  setDoc(doc(db, PARTES, parte.id), { observaciones, updatedAt: Timestamp.now() }, { merge: true })
}

// Listado para el panel del encargado — últimos partes de todas las plantas.
export const subscribePartesRecientes = (
  callback: (partes: ParteMaquinas[]) => void,
): (() => void) =>
  onSnapshot(
    query(collection(db, PARTES), orderBy('createdAt', 'desc'), limit(90)),
    (snap) => callback(snap.docs.map((d) => normalizar(d.id, d.data()))),
    () => callback([]),
  )
