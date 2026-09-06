import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from './firebase'
import type { EmpresaTango, PreciosTango } from '../utils/precioTango'
import { onSnapshotError } from './observability'

// preciosTango/{empresa}: precios y listas sincronizados desde Tango (los
// escribe la Cloud Function syncPreciosTango; ver utils/precioTango.ts).
export const subscribePreciosTango = (
  empresa: EmpresaTango,
  callback: (precios: PreciosTango | null) => void,
): (() => void) =>
  onSnapshot(
    doc(db, 'preciosTango', empresa),
    (snap: DocumentSnapshot) => callback(snap.exists() ? (snap.data() as PreciosTango) : null),
    onSnapshotError(() => callback(null), 'preciosTango'),
  )

export interface ResumenSyncPrecios {
  empresas: Record<string, { listas: number; productos: number; especiales: number; errores: string[]; clientesConLista: number }>
  usuariosActualizados: number
}

/** Botón "Sincronizar ahora": corre la misma sync que la programada. */
export async function sincronizarPreciosTangoAhora(): Promise<ResumenSyncPrecios> {
  const fn = httpsCallable<void, ResumenSyncPrecios>(getFunctions(), 'sincronizarPreciosTangoAhora')
  return (await fn()).data
}

// Clientes y saldos por Tango Connect (functions/src/triggers/tangoConnectSync.ts).
export interface ResumenSyncClientesEmpresa {
  company?: number
  recibidos: number
  actualizados: number
  matchedByIdGva14: number
  matchedByCuit: number
  matchedByCodigo?: number
  newlyLinkedCodigoTango: number
  codigosSecundarios?: number
  skippedNoMatch: number
  skippedAmbiguousCuit: number
  emailsActualizados: number
  emailsConError: number
  errores: unknown[]
}
export interface ResumenSyncClientes extends ResumenSyncClientesEmpresa {
  // Por empresa desde el 2026-09-06; las corridas anteriores no lo traen.
  empresas?: Partial<Record<'redonhielo' | 'rolito', ResumenSyncClientesEmpresa>>
}
export interface ResumenSyncSaldosEmpresa {
  company?: number
  filas: number
  clientesConDeuda: number
  actualizados: number
  skippedNoMatch: number
  vaciados: number
  error?: string
}
export interface ResumenSyncSaldos extends ResumenSyncSaldosEmpresa {
  empresas?: Partial<Record<'redonhielo' | 'rolito', ResumenSyncSaldosEmpresa>>
}

export async function sincronizarClientesTangoAhora(): Promise<ResumenSyncClientes> {
  const fn = httpsCallable<void, ResumenSyncClientes>(getFunctions(), 'sincronizarClientesTangoAhora')
  return (await fn()).data
}

export async function sincronizarSaldosTangoAhora(): Promise<ResumenSyncSaldos> {
  const fn = httpsCallable<void, ResumenSyncSaldos>(getFunctions(), 'sincronizarSaldosTangoAhora')
  return (await fn()).data
}
