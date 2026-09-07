import { useState, KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { MAX_RACKS_POR_VIAJE, parseRacks } from '@/utils/envases'

// Números de rack de agua, como chips. Se agregan con Enter, coma, espacio o
// al salir del campo; pegar "12 15 18" carga los tres. `sugeridos` (muelle):
// los racks que salieron en el remito, en gris — tocar uno lo marca como
// devuelto. Compartido por caja (remito de carga) y muelle (descarga).
export default function RacksInput({ value, onChange, sugeridos = [], disabled }: {
  value:      number[]
  onChange:   (racks: number[]) => void
  sugeridos?: number[]
  disabled?:  boolean
}) {
  const [texto, setTexto] = useState('')

  const agregar = (crudo: string) => {
    const nuevos = parseRacks(crudo).filter((n) => !value.includes(n))
    if (nuevos.length) onChange([...value, ...nuevos].slice(0, MAX_RACKS_POR_VIAJE))
    setTexto('')
  }
  const quitar = (n: number) => onChange(value.filter((x) => x !== n))

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') { e.preventDefault(); agregar(texto) }
    else if (e.key === 'Backspace' && !texto && value.length) quitar(value[value.length - 1])
  }

  const pendientes = sugeridos.filter((n) => !value.includes(n))

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 bg-white border border-[#D3D1C7] rounded-lg px-2 py-1.5 focus-within:ring-1 focus-within:ring-accent">
        {value.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 bg-accent/10 text-accent text-sm font-medium rounded-md px-2 py-0.5">
            {n}
            {!disabled && (
              <button type="button" onClick={() => quitar(n)} aria-label={`Quitar rack ${n}`} className="hover:text-red-600">
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => texto && agregar(texto)}
          onPaste={(e) => { e.preventDefault(); agregar(e.clipboardData.getData('text')) }}
          inputMode="numeric"
          disabled={disabled}
          placeholder={value.length ? '' : 'Nº de rack, Enter para agregar'}
          className="flex-1 min-w-[9rem] bg-transparent text-sm text-gray-900 py-0.5 focus:outline-none disabled:opacity-50"
        />
      </div>
      {pendientes.length > 0 && !disabled && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
          <span>Salieron:</span>
          {pendientes.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange([...value, n])}
              className="border border-dashed border-[#D3D1C7] rounded-md px-2 py-0.5 text-gray-600 hover:border-accent hover:text-accent"
              title="Tocar para marcarlo como devuelto"
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
