import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import type { EmpresaTango, FacturaTangoDetalle, RemitoTangoDetalle, TangoComprobantesDoc } from '@/types'

// Facturas y remitos de Tango de los últimos meses (2026-09-09): índice por
// código de cliente y detalle por comprobante. Solo lectura desde la app: los
// escribe el lector de la VM (scripts/tango/bridge-sync-comprobantes.mjs).

export const idIndiceTango = (empresa: EmpresaTango, codigo: string) => `${empresa}_${codigo}`
export const idDetalleTango = (empresa: EmpresaTango, tipo: string, numero: string) => `${empresa}_${tipo.replace('/', '').toUpperCase()}_${numero.trim().toUpperCase()}`

export function subscribeTangoComprobantes(
  empresa: EmpresaTango,
  codigo: string,
  cb: (docu: TangoComprobantesDoc | null) => void,
): () => void {
  return onSnapshot(
    doc(db, 'tangoComprobantes', idIndiceTango(empresa, codigo)),
    (snap) => cb(snap.exists() ? ({ id: snap.id, facturas: {}, remitos: {}, ...snap.data() } as TangoComprobantesDoc) : null),
    (err) => { reportError(err, { subscription: 'tangoComprobantes', empresa, codigo }); cb(null) },
  )
}

export async function getFacturaTangoDetalle(empresa: EmpresaTango, tipo: string, numero: string): Promise<FacturaTangoDetalle | null> {
  const snap = await getDoc(doc(db, 'tangoComprobanteDetalle', idDetalleTango(empresa, tipo, numero)))
  if (!snap.exists()) return null
  const d = snap.data() as FacturaTangoDetalle
  return d.tipo === 'REM' ? null : d
}

export async function getRemitoTangoDetalle(empresa: EmpresaTango, numero: string): Promise<RemitoTangoDetalle | null> {
  const snap = await getDoc(doc(db, 'tangoComprobanteDetalle', idDetalleTango(empresa, 'REM', numero)))
  if (!snap.exists()) return null
  const d = snap.data() as RemitoTangoDetalle
  return d.tipo === 'REM' ? d : null
}

/**
 * Mail al que se le mandan los comprobantes a un cliente (2026-09-10): el de la
 * ficha de Tango (índices tangoComprobantes de sus códigos) o, si Tango no lo
 * tiene, el de la app salvo que sea el de login. Para pantallas que no tienen
 * la ficha cargada (Mis ventas del chofer): se resuelve al elegir "Mail".
 */
export async function getEmailClienteTango(clienteUid: string): Promise<string> {
  const { getUserDocument } = await import('./userService')
  const { tangoIdsDe } = await import('@/utils/tangoEmpresas')
  const { emailDelCliente } = await import('@/utils/comprobantesTango')
  const perfil = await getUserDocument(clienteUid).catch(() => null)
  if (!perfil) return ''
  const ids = tangoIdsDe(perfil)
  const indices: TangoComprobantesDoc[] = []
  for (const empresa of Object.keys(ids) as EmpresaTango[]) {
    for (const x of ids[empresa] ?? []) {
      const snap = await getDoc(doc(db, 'tangoComprobantes', idIndiceTango(empresa, x.codigo))).catch(() => null)
      if (snap?.exists()) indices.push({ id: snap.id, facturas: {}, remitos: {}, ...snap.data() } as TangoComprobantesDoc)
    }
  }
  return emailDelCliente(perfil, indices)
}
