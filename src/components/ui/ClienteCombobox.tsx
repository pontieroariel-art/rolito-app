import { useState, useEffect, useRef } from 'react'
import { UserProfile } from '../../types'

export interface ComboItem {
  uid:     string
  label:   string
  codigo?: string
}

export function toComboItems(clientes: UserProfile[]): ComboItem[] {
  return clientes.map((c) => ({
    uid:    c.uid,
    label:  c.razonSocial || c.nombreContacto || c.nombre || c.email || '',
    codigo: c.codigoCliente,
  }))
}

interface Props {
  items:       ComboItem[]
  value:       string
  onChange:    (uid: string) => void
  placeholder?: string
  allLabel?:   string  // si se provee, agrega opción "todos" al inicio (value = 'todos')
  className?:  string
}

export default function ClienteCombobox({
  items,
  value,
  onChange,
  placeholder = '— Seleccioná un cliente —',
  allLabel,
  className = '',
}: Props) {
  const [query, setQuery] = useState('')
  const [open,  setOpen]  = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = value === 'todos'
    ? null
    : items.find((i) => i.uid === value)

  const filtered = query.trim()
    ? items.filter((i) => {
        const q = query.toLowerCase()
        return (
          i.label.toLowerCase().includes(q) ||
          (i.codigo || '').toLowerCase().includes(q)
        )
      }).slice(0, 50)
    : items.slice(0, 50)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (uid: string) => {
    onChange(uid)
    setQuery('')
    setOpen(false)
  }

  const displayLabel = value === 'todos' && allLabel
    ? allLabel
    : selected
      ? (selected.codigo ? `[${selected.codigo}] ${selected.label}` : selected.label)
      : null

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div
        onClick={() => setOpen((o) => !o)}
        className={`w-full bg-white border rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-2 cursor-pointer select-none ${
          open ? 'border-accent ring-1 ring-accent' : 'border-[#D3D1C7]'
        }`}
      >
        {displayLabel
          ? <span className="text-gray-900 truncate">{displayLabel}</span>
          : <span className="text-gray-400 truncate">{placeholder}</span>
        }
        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-[#D3D1C7] rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-[#D3D1C7]">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o código..."
              className="w-full text-sm px-2 py-1.5 bg-[#F8F7F2] rounded border border-[#D3D1C7] focus:outline-none focus:ring-1 focus:ring-accent text-gray-900 placeholder-gray-400"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <ul className="max-h-72 overflow-y-auto">
            {allLabel && !query && (
              <li
                onClick={() => select('todos')}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-[#F0EEE7] ${
                  value === 'todos' ? 'bg-[#E8F5F0] text-accent font-medium' : 'text-gray-500'
                }`}
              >
                {allLabel}
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400">Sin resultados</li>
            ) : (
              filtered.map((item) => (
                <li
                  key={item.uid}
                  onClick={() => select(item.uid)}
                  className={`px-3 py-2 text-sm cursor-pointer hover:bg-[#F0EEE7] flex items-center gap-2 ${
                    item.uid === value ? 'bg-[#E8F5F0] text-accent font-medium' : 'text-gray-900'
                  }`}
                >
                  {item.codigo && (
                    <span className="text-gray-400 text-xs shrink-0">[{item.codigo}]</span>
                  )}
                  <span className="truncate">{item.label}</span>
                </li>
              ))
            )}
          </ul>
          {items.length > 50 && !query && (
            <p className="px-3 py-1.5 text-xs text-gray-400 border-t border-[#D3D1C7]">
              Escribí para filtrar entre {items.length} clientes
            </p>
          )}
        </div>
      )}
    </div>
  )
}
