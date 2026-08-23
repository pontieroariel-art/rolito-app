import { collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { UserRole } from '../types'

// Auditoría de cambios hechos desde el Backoffice (Usuarios & Roles, Flota,
// Modelos, Catálogos de service, Técnicos, Pañol) — colección append-only,
// mismo patrón que historialPreciosService.ts. Un trigger de Cloud Functions
// (functions/src/triggers/adminAudit.ts) escucha esta colección: si
// `riesgo` es 'alto' manda un mail instantáneo, si es 'rutina' se junta en
// el resumen diario. Ver plan de migración del Backoffice, Fase 4.

export type AccionAdmin =
  | 'creado' | 'modificado' | 'activado' | 'desactivado'
  | 'rol_cambiado' | 'usuario_creado' | 'usuario_desactivado'

export interface ActorAdmin {
  uid:    string
  nombre: string
  rol:    UserRole
}

export interface HistorialAdminEvento {
  id:        string
  coleccion: string          // 'flota' | 'modelosHeladera' | 'users' | etc.
  docId:     string
  accion:    AccionAdmin
  detalle?:  string | null
  riesgo:    'alto' | 'rutina'
  actor:     ActorAdmin
  fecha:     unknown          // Timestamp — no tipado estricto para no importar firebase/firestore en callers
}

const COL = 'historialAdmin'

const registrar = (data: {
  coleccion: string
  docId:     string
  accion:    AccionAdmin
  detalle?:  string | null
  riesgo:    'alto' | 'rutina'
  actor:     ActorAdmin
}): Promise<void> =>
  addDoc(collection(db, COL), {
    coleccion: data.coleccion,
    docId:     data.docId,
    accion:    data.accion,
    detalle:   data.detalle ?? null,
    riesgo:    data.riesgo,
    actor:     data.actor,
    fecha:     serverTimestamp(),
  }).then(() => {})

// Alto riesgo — dispara mail instantáneo (cambio de rol, alta/baja de
// personal). No debe fallar la operación principal si esto falla: se llama
// después de que la escritura real ya se confirmó.
export const registrarAccionAlto = (data: {
  coleccion: string
  docId:     string
  accion:    AccionAdmin
  detalle?:  string | null
  actor:     ActorAdmin
}): Promise<void> => registrar({ ...data, riesgo: 'alto' })

// Rutina — catálogos/config (Flota, Modelos, Catálogos de service, Técnicos,
// Pañol). Se junta en el resumen diario.
export const registrarAccionRutina = (data: {
  coleccion: string
  docId:     string
  accion:    AccionAdmin
  detalle?:  string | null
  actor:     ActorAdmin
}): Promise<void> => registrar({ ...data, riesgo: 'rutina' })

export const getHistorialAdmin = async (limitN = 200): Promise<HistorialAdminEvento[]> => {
  const snap = await getDocs(query(collection(db, COL), orderBy('fecha', 'desc'), limit(limitN)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as HistorialAdminEvento))
}
