import {
  collection, addDoc, query, where, orderBy,
  getDocs, limit, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { HistorialPrecioEvento } from '../types'

const COL = 'historialPrecios'

// ── Registrar cambio de lista asignada ────────────────────────────────────────

export const registrarCambioLista = async (data: {
  clientId:             string
  clientName:           string
  listaAnteriorId?:     string | null
  listaAnteriorNombre?: string | null
  listaNuevaId?:        string | null
  listaNuevaNombre?:    string | null
  modificadoPor:        string
  modificadoPorNombre:  string
  motivo?:              string
}): Promise<void> => {
  await addDoc(collection(db, COL), {
    clientId:             data.clientId,
    clientName:           data.clientName,
    tipo:                 'lista',
    listaAnteriorId:      data.listaAnteriorId    ?? null,
    listaAnteriorNombre:  data.listaAnteriorNombre ?? null,
    listaNuevaId:         data.listaNuevaId        ?? null,
    listaNuevaNombre:     data.listaNuevaNombre    ?? null,
    modificadoPor:        data.modificadoPor,
    modificadoPorNombre:  data.modificadoPorNombre,
    motivo:               data.motivo ?? null,
    fecha:                serverTimestamp(),
  })
}

// ── Registrar cambios de precios custom ───────────────────────────────────────

export type CambioCustom = {
  productoId:    string
  productoNombre: string
  precioAnterior: number | null
  precioNuevo:    number | null
  accion:         'agregado' | 'modificado' | 'eliminado'
  vigenciaHasta?: string | null
}

export const registrarCambiosCustom = async (data: {
  clientId:           string
  clientName:         string
  cambios:            CambioCustom[]
  modificadoPor:      string
  modificadoPorNombre: string
  motivo?:            string
}): Promise<void> => {
  if (data.cambios.length === 0) return
  await Promise.all(
    data.cambios.map((c) =>
      addDoc(collection(db, COL), {
        clientId:            data.clientId,
        clientName:          data.clientName,
        tipo:                'custom',
        productoId:          c.productoId,
        productoNombre:      c.productoNombre,
        precioAnterior:      c.precioAnterior,
        precioNuevo:         c.precioNuevo,
        accion:              c.accion,
        vigenciaHasta:       c.vigenciaHasta
          ? Timestamp.fromDate(new Date(c.vigenciaHasta + 'T23:59:59'))
          : null,
        modificadoPor:       data.modificadoPor,
        modificadoPorNombre: data.modificadoPorNombre,
        motivo:              data.motivo ?? null,
        fecha:               serverTimestamp(),
      }),
    ),
  )
}

// ── Queries ───────────────────────────────────────────────────────────────────

export const getHistorialCliente = async (clientId: string): Promise<HistorialPrecioEvento[]> => {
  const snap = await getDocs(
    query(collection(db, COL), where('clientId', '==', clientId), orderBy('fecha', 'desc'), limit(100)),
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as HistorialPrecioEvento))
}

export const getAllHistorial = async (limitN = 300): Promise<HistorialPrecioEvento[]> => {
  const snap = await getDocs(
    query(collection(db, COL), orderBy('fecha', 'desc'), limit(limitN)),
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as HistorialPrecioEvento))
}
