import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from './firebase'
import type { EmpresaTango, PreciosTango } from '../utils/precioTango'
import { onSnapshotError } from './observability'

// Las syncs manuales (clientes ~2 min, altas hasta 9 min) superan los 70 s
// que espera httpsCallable por defecto: el navegador cortaba con
// deadline-exceeded aunque la Function terminara bien.
const TIMEOUT_SYNC_MS = 9 * 60_000

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
  const fn = httpsCallable<void, ResumenSyncPrecios>(getFunctions(), 'sincronizarPreciosTangoAhora', { timeout: TIMEOUT_SYNC_MS })
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
export interface ResumenAltasEncoladas {
  candidatos: number
  encolados: number
  yaEncolados: number
  descartados: number
  porMotivo: Record<string, number>
  ejemplosDescartados: Array<{ empresa: string; idGva14: number; codigo: string; cuit: string; nombre: string; motivo: string }>
}
export interface ResumenBajas {
  enabled: boolean
  evaluadas: number
  bajas: number
  reactivadas: number
  corridaConfiable: Partial<Record<'redonhielo' | 'rolito', boolean>>
  topeAlcanzado: boolean
  ejemplos: Array<{ uid: string; razonSocial: string; accion: string; motivo?: string }>
}
export interface ResumenSyncClientes extends ResumenSyncClientesEmpresa {
  // Por empresa desde el 2026-09-06; las corridas anteriores no lo traen.
  empresas?: Partial<Record<'redonhielo' | 'rolito', ResumenSyncClientesEmpresa>>
  altas?: ResumenAltasEncoladas
  bajas?: ResumenBajas
}
// Padrón maestro: cuentas creadas desde la cola tango-altas (tangoAltas.ts).
export interface ResumenAltas {
  procesadas: number
  creadas: number
  existian: number
  errores: number
  pendientesRestantes: number
  detalleErrores: Array<{ cuit: string; motivo: string }>
  crear: boolean
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
  const fn = httpsCallable<void, ResumenSyncClientes>(getFunctions(), 'sincronizarClientesTangoAhora', { timeout: TIMEOUT_SYNC_MS })
  return (await fn()).data
}

export async function procesarAltasTangoAhora(): Promise<ResumenAltas> {
  const fn = httpsCallable<void, ResumenAltas>(getFunctions(), 'procesarAltasTangoAhora', { timeout: TIMEOUT_SYNC_MS })
  return (await fn()).data
}

export async function sincronizarSaldosTangoAhora(): Promise<ResumenSyncSaldos> {
  const fn = httpsCallable<void, ResumenSyncSaldos>(getFunctions(), 'sincronizarSaldosTangoAhora', { timeout: TIMEOUT_SYNC_MS })
  return (await fn()).data
}
