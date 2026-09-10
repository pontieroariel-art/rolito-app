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
