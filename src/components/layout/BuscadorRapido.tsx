import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SISTEMA_LABELS } from '@/utils/sistemas'
import type { Sistema } from '@/types'

export interface ItemBuscable { to: string; label: string; icon: LucideIcon; grupo: string; sistema: Sistema }

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Buscador rápido de pantallas (Ctrl/⌘ + K) del shell de escritorio: filtra
// por nombre entre todo lo que el usuario puede abrir en cualquiera de sus
// dominios, flechas para moverse, Enter para ir. Sin dependencias.
export default function BuscadorRapido({ items, onCerrar }: { items: ItemBuscable[]; onCerrar: () => void }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [])

  const visibles = useMemo(() => {
    const n = normalizar(q.trim())
    const lista = n ? items.filter((i) => normalizar(`${i.label} ${i.grupo} ${SISTEMA_LABELS[i.sistema]}`).includes(n)) : items
    return lista.slice(0, 12)
  }, [items, q])

  useEffect(() => { setSel(0) }, [q])

  const ir = (i: ItemBuscable | undefined) => { if (!i) return; onCerrar(); navigate(i.to) }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onCerrar() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, visibles.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); ir(visibles[sel]) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]" onClick={onCerrar}>
      <div
        role="dialog" aria-label="Buscar pantalla"
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-[#D3D1C7] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-2 px-4 h-12 border-b border-[#D3D1C7]">
          <Search size={16} className="text-gray-400 shrink-0" />
          <input
            ref={input}
            id="buscador-rapido"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ir a una pantalla…"
            className="flex-1 text-sm outline-none bg-transparent placeholder:text-gray-400"
          />
          <kbd className="text-[10px] text-gray-400 border border-gray-200 rounded px-1">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {visibles.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">Nada con ese nombre.</li>}
          {visibles.map((i, idx) => (
            <li key={`${i.sistema}${i.to}`}>
              <button
                type="button"
                onMouseEnter={() => setSel(idx)}
                onClick={() => ir(i)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm ${idx === sel ? 'bg-accent/10 text-accent' : 'text-gray-700'}`}
              >
                <i.icon size={16} className="shrink-0" />
                <span className="flex-1 truncate">{i.label}</span>
                <span className="text-[11px] text-gray-400 truncate">{SISTEMA_LABELS[i.sistema]} · {i.grupo}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
