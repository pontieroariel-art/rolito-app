import { Ban } from 'lucide-react'
import { formatoARS } from '@/utils/money'
import { MOTIVOS_ANULACION, type AnulacionPosterior, type MotivoAnulacion } from '@/types'

// Ventas de un cierre (liquidación del repartidor o caja) que se anularon
// DESPUÉS de cerrarlo (2026-09-11): el cierre no se reabre, queda esta nota.
// Los importes del cierre siguen siendo los rendidos ese día.

/** Resumen corto para una celda de tabla. Puro. */
export const resumenAnuladas = (xs: AnulacionPosterior[] | undefined): { cantidad: number; total: number } => ({
  cantidad: xs?.length ?? 0,
  total: (xs ?? []).reduce((s, a) => s + a.total, 0),
})

export default function AnuladasDespuesDeCerrar({ anulaciones, compacto = false }: { anulaciones: AnulacionPosterior[] | undefined; compacto?: boolean }) {
  if (!anulaciones?.length) return null
  const { cantidad, total } = resumenAnuladas(anulaciones)
  if (compacto) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700 font-medium" title={anulaciones.map((a) => `${a.comprobante} · ${a.clienteNombre} · ${formatoARS(a.total)}`).join('\n')}>
        <Ban size={12} /> {cantidad} anulada{cantidad === 1 ? '' : 's'} después · {formatoARS(total)}
      </span>
    )
  }
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
      <p className="font-semibold text-red-800 flex items-center gap-1.5"><Ban size={14} /> {cantidad === 1 ? 'Una venta anulada después de cerrar' : `${cantidad} ventas anuladas después de cerrar`} · {formatoARS(total)}</p>
      <p className="text-xs text-red-700 mt-0.5">El cierre no se reabre: lo rendido ese día queda como está. Estos comprobantes ya no valen.</p>
      <ul className="mt-1.5 space-y-0.5 text-xs text-red-900">
        {anulaciones.map((a) => (
          <li key={a.ventaId}>
            <b>{a.comprobante}</b> · {a.clienteNombre} · {formatoARS(a.total)} · {MOTIVOS_ANULACION[a.motivo as MotivoAnulacion] ?? a.motivo}{a.nota ? ` · ${a.nota}` : ''}{a.pedidoPor ? ` (${a.pedidoPor})` : ''}
            {a.en?.toDate ? <span className="text-red-600"> · {a.en.toDate().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
