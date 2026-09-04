import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { getOrdersInRange } from '../../services/orderService'
import { useHeladeras } from '../../hooks/useHeladeras'
import { kgHielo } from '../../utils/helpers'

function monthBounds(year: number, month: number) {
  const start = new Date(year, month, 1, 0, 0, 0, 0)
  const end   = new Date(year, month + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

export default function RankingConsumoPage() {
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const { start, end } = monthBounds(year, month)
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['ranking-consumo', year, month],
    queryFn:  () => getOrdersInRange(start, end),
  })
  const { heladeras, loading: loadingHeladeras } = useHeladeras()

  const clientesConHeladera = useMemo(
    () => new Set(heladeras.filter((h) => h.estado === 'en_comodato' && h.clienteAsignadoId).map((h) => h.clienteAsignadoId)),
    [heladeras],
  )

  const ranking = useMemo(() => {
    const map: Record<string, { clientId: string; nombre: string; kg: number; pedidos: number }> = {}
    for (const o of orders) {
      if (o.status !== 'entregado') continue
      if (!map[o.clientId]) map[o.clientId] = { clientId: o.clientId, nombre: o.clientName, kg: 0, pedidos: 0 }
      map[o.clientId].kg += kgHielo(o.products)
      map[o.clientId].pedidos += 1
    }
    return Object.values(map).sort((a, b) => b.kg - a.kg)
  }, [orders])

  const monthLabel = new Date(year, month, 1)
    .toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    .replace(/^./, (c) => c.toUpperCase())

  const prevMonth = () => { if (month === 0) { setYear((y) => y - 1); setMonth(11) } else setMonth((m) => m - 1) }
  const nextMonth = () => { if (month === 11) { setYear((y) => y + 1); setMonth(0) } else setMonth((m) => m + 1) }

  // xlsx (484K) se carga recién acá, al exportar — no al abrir la pantalla
  const exportExcel = async () => {
    const XLSX = await import('xlsx')
    const rows = ranking.map((r) => ({
      Cliente: r.nombre,
      'Kg de hielo': r.kg,
      Pedidos: r.pedidos,
      'Heladera asignada': clientesConHeladera.has(r.clientId) ? 'Sí' : 'No',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Ranking de consumo')
    XLSX.writeFile(wb, `ranking-consumo_${year}-${String(month + 1).padStart(2, '0')}.xlsx`)
  }

  const isLoading = loadingOrders || loadingHeladeras

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
      <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Ranking de consumo</h1>
            <p className="text-gray-500 text-sm mt-0.5">{monthLabel}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-white border border-transparent hover:border-gray-200 transition-colors">
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={nextMonth}
              disabled={isCurrentMonth}
              className="p-2 rounded-lg hover:bg-white border border-transparent hover:border-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={18} />
            </button>
            <button
              onClick={exportExcel}
              disabled={isLoading || ranking.length === 0}
              className="ml-2 flex items-center gap-2 bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={14} />
              Exportar
            </button>
          </div>
        </div>

        {isLoading ? <LoadingSpinner /> : ranking.length === 0 ? (
          <p className="text-gray-400 text-sm">Sin entregas de hielo en este mes.</p>
        ) : (
          <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-[#D3D1C7] bg-[#F8F7F2]">
                  <th className="text-left text-gray-500 text-xs py-3 px-4 font-medium">Cliente</th>
                  <th className="text-right text-gray-500 text-xs py-3 px-4 font-medium">Kg de hielo</th>
                  <th className="text-right text-gray-500 text-xs py-3 px-4 font-medium">Pedidos</th>
                  <th className="text-center text-gray-500 text-xs py-3 px-4 font-medium">Heladera asignada</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r) => (
                  <tr key={r.clientId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 px-4 text-gray-900">{r.nombre}</td>
                    <td className="py-2.5 px-4 text-right font-medium text-accent">{r.kg.toLocaleString('es-AR')}</td>
                    <td className="py-2.5 px-4 text-right text-gray-500">{r.pedidos}</td>
                    <td className="py-2.5 px-4 text-center">
                      {clientesConHeladera.has(r.clientId) ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">Sí</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
