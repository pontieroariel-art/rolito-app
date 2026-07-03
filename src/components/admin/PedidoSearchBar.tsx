import { useEffect, useRef, useState } from 'react'
import { Search, X, Eye } from 'lucide-react'
import { searchOrdersByClientName, searchOrdersByNumeroOC, getOrdersInRange } from '../../services/orderService'
import { formatShortDate, summarizeProducts } from '../../utils/helpers'
import { STATUS_LABELS } from '../../utils/constants'
import { Order } from '../../types'

type Mode = 'cliente' | 'oc' | 'fecha'

const MODES: { id: Mode; label: string }[] = [
  { id: 'cliente', label: 'Cliente' },
  { id: 'oc',      label: 'Orden de compra' },
  { id: 'fecha',   label: 'Fecha' },
]

interface Props {
  onJumpAndHighlight: (order: Order) => void
  onOpenDetail:       (order: Order) => void
}

export default function PedidoSearchBar({ onJumpAndHighlight, onOpenDetail }: Props) {
  const [mode,    setMode]    = useState<Mode>('cliente')
  const [text,    setText]    = useState('')
  const [date,    setDate]    = useState('')
  const [results, setResults] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [open,    setOpen]    = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  useEffect(() => {
    if (mode === 'fecha') {
      if (!date) { setResults([]); return }
      setLoading(true)
      const start = new Date(date + 'T00:00:00')
      const end   = new Date(date + 'T23:59:59')
      getOrdersInRange(start, end).then((r) => { setResults(r); setLoading(false); setOpen(true) })
      return
    }
    const t = text.trim()
    if (t.length < 2) { setResults([]); return }
    setLoading(true)
    const timer = setTimeout(() => {
      const fn = mode === 'cliente' ? searchOrdersByClientName : searchOrdersByNumeroOC
      fn(t).then((r) => { setResults(r); setLoading(false); setOpen(true) })
    }, 300)
    return () => clearTimeout(timer)
  }, [mode, text, date])

  const clear = () => { setText(''); setDate(''); setResults([]); setOpen(false) }

  const handleSelectRow = (order: Order) => {
    onJumpAndHighlight(order)
    setOpen(false)
  }

  const handleDetail = (e: React.MouseEvent, order: Order) => {
    e.stopPropagation()
    onOpenDetail(order)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative mb-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 shrink-0">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => { setMode(m.id); setText(''); setDate(''); setResults([]) }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                mode === m.id
                  ? 'bg-accent/10 border-accent text-accent'
                  : 'bg-white border-[#D3D1C7] text-gray-500 hover:border-accent/50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          {mode === 'fecha' ? (
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onFocus={() => results.length > 0 && setOpen(true)}
              className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
          ) : (
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => results.length > 0 && setOpen(true)}
              placeholder={mode === 'cliente' ? 'Buscar pedido por cliente…' : 'Buscar pedido por N° de OC…'}
              className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent placeholder-gray-400"
            />
          )}
          {(text || date) && (
            <button onClick={clear} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-600 transition-colors">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="absolute z-40 mt-1.5 w-full max-w-lg bg-white border border-[#D3D1C7] rounded-xl shadow-lg overflow-hidden">
          {loading ? (
            <p className="text-xs text-gray-400 px-3 py-3 text-center">Buscando…</p>
          ) : results.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 py-3 text-center">Sin resultados</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-gray-100">
              {results.map((o) => (
                <li
                  key={o.id}
                  onClick={() => handleSelectRow(o)}
                  className="flex items-start justify-between gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 truncate">{o.clientName || '—'}</p>
                      <span className="text-[10px] text-gray-400 shrink-0">{STATUS_LABELS[o.status]}</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate">{o.clientAddress || 'Sin dirección'}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {formatShortDate(o.date)}
                      {o.numeroOC ? ` · OC #${o.numeroOC}` : ''}
                      {' · '}{summarizeProducts(o.products)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDetail(e, o)}
                    title="Ver detalle"
                    className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-accent/10 transition-colors"
                  >
                    <Eye size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
