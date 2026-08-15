import { useTicketsPorHeladera } from '../../hooks/useTicketsPorHeladera'
import { tsToDate } from '../../utils/helpers'

const ESTADO_LABELS: Record<string, string> = {
  abierto: 'Abierto', asignado_tecnico: 'Con técnico', asignado_chofer: 'Con chofer',
  cerrado: 'Cerrado', anulado: 'Anulado',
}
const ESTADO_STYLES: Record<string, string> = {
  abierto:          'bg-amber-100 text-amber-700 border-amber-200',
  asignado_tecnico: 'bg-blue-100 text-blue-700 border-blue-200',
  asignado_chofer:  'bg-blue-100 text-blue-700 border-blue-200',
  cerrado:          'bg-green-100 text-green-700 border-green-200',
  anulado:          'bg-gray-100 text-gray-500 border-gray-200',
}

export default function TicketsServicioList({ heladeraId }: { heladeraId: string }) {
  const { tickets, loading } = useTicketsPorHeladera(heladeraId)

  if (loading) return null
  if (tickets.length === 0) return <p className="text-gray-400 text-xs">Sin tickets de service para este equipo.</p>

  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto">
      {tickets.map((t) => (
        <div key={t.id} className="border border-[#D3D1C7] rounded-lg px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-gray-900">{t.motivoNombre}</p>
              <p className="text-xs text-gray-500">
                {tsToDate(t.fechaPedido).toLocaleDateString('es-AR')}
                {t.asignadoA ? ` · ${t.asignadoA.nombre}` : ''}
              </p>
              {t.trabajoRealizado && <p className="text-xs text-gray-500 mt-0.5">{t.trabajoRealizado}</p>}
              {t.motivoAnulacion && <p className="text-xs text-red-500 mt-0.5">Anulado: {t.motivoAnulacion}</p>}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${ESTADO_STYLES[t.estado] ?? ''}`}>
              {ESTADO_LABELS[t.estado] ?? t.estado}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
