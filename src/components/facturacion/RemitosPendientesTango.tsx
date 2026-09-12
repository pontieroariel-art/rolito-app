import { useEffect, useState } from 'react'
import { Ban } from 'lucide-react'
import { subscribeRemitosPendientesEnTango } from '@/services/ventaCamionService'
import { formatoARS } from '@/utils/money'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'
import { codigoComprobanteInterno } from '@/utils/numeracionInterna'
import { MOTIVOS_ANULACION, type VentaCamion } from '@/types'

// Remitos que un chofer (o facturación) anuló en la app y que la oficina
// todavía tiene que anular en Tango (2026-09-12). Hasta que la app los anule
// sola en Tango, esta lista reemplaza a "acordarse de la push". Cada fila
// desaparece sola cuando el lector de comprobantes ve el remito anulado.

const numeroRemito = (v: VentaCamion) => v.tango?.remitoNumero ?? (v.comprobanteInterno ? codigoComprobanteInterno(v.comprobanteInterno) : 'sin número')

export default function RemitosPendientesTango() {
  const [ventas, setVentas] = useState<VentaCamion[]>([])
  useEffect(() => subscribeRemitosPendientesEnTango(setVentas), [])
  if (ventas.length === 0) return null
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-red-800 flex items-center gap-2"><Ban size={16} /> Remitos anulados en la app que hay que anular en Tango</h2>
        <span className="text-xs text-red-700">{ventas.length} {ventas.length === 1 ? 'pendiente' : 'pendientes'} · la fila desaparece sola cuando Tango lo refleje (hasta 1 h)</span>
      </div>
      <ul className="divide-y divide-red-100 text-sm">
        {ventas.map((v) => {
          const a = v.anulacion
          return (
            <li key={v.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-mono font-semibold text-gray-900">{numeroRemito(v)}</span>
              <span className="text-gray-800">{nombreClienteVenta(v)}</span>
              <span className="text-gray-500 tabular-nums">{formatoARS(v.total)}</span>
              <span className="text-gray-500">{v.choferNombre}</span>
              <span className="text-xs text-gray-500">
                anulado {a?.anuladaEn?.toDate ? a.anuladaEn.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                {a?.anuladaPor?.nombre ? ` por ${a.anuladaPor.nombre}` : ''}
                {a?.motivo ? ` · ${MOTIVOS_ANULACION[a.motivo] ?? a.motivo}` : ''}{a?.nota ? ` · ${a.nota}` : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
