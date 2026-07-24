import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DIAS_SEMANA } from '../../types'

interface Props {
  selected:       Set<string>              // fechas YYYY-MM-DD
  onChange:       (next: Set<string>) => void
  existingDates?: Set<string>              // días con un pedido activo ya cargado (aviso, no bloqueo)
  minDate?:       string                   // por defecto hoy — no se puede navegar/elegir antes
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayStr(): string {
  return toDateStr(new Date())
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export default function MultiDatePicker({ selected, onChange, existingDates, minDate }: Props) {
  const min = minDate || todayStr()
  const [minYear, minMonth] = min.split('-').map(Number)

  const [visibleMonth, setVisibleMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1, 12)
  })

  const year  = visibleMonth.getFullYear()
  const month = visibleMonth.getMonth()
  const isAtMinMonth = year === minYear && (month + 1) === minMonth

  const toggle = (dateStr: string) => {
    if (dateStr < min) return
    const next = new Set(selected)
    if (next.has(dateStr)) next.delete(dateStr)
    else next.add(dateStr)
    onChange(next)
  }

  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth  = new Date(year, month + 1, 0).getDate()
  const cells: Array<number | null> = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setVisibleMonth(new Date(year, month - 1, 1, 12))}
          disabled={isAtMinMonth}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <p className="text-sm font-medium text-gray-900">{MESES[month]} {year}</p>
        <button
          type="button"
          onClick={() => setVisibleMonth(new Date(year, month + 1, 1, 12))}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-white transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="text-center text-[10px] text-gray-400 font-medium py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />
          const dateStr    = toDateStr(new Date(year, month, day, 12))
          const isPast     = dateStr < min
          const isSelected = selected.has(dateStr)
          const hasExisting = existingDates?.has(dateStr)
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => toggle(dateStr)}
              disabled={isPast}
              title={hasExisting ? 'Ya hay un pedido activo ese día' : undefined}
              className={`relative aspect-square rounded-lg text-xs flex items-center justify-center transition-colors ${
                isPast
                  ? 'text-gray-300 cursor-not-allowed'
                  : isSelected
                  ? 'bg-accent text-white font-semibold'
                  : 'bg-white border border-[#D3D1C7] text-gray-700 hover:border-accent/60'
              }`}
            >
              {day}
              {hasExisting && !isPast && (
                <span className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-amber-500'}`} />
              )}
            </button>
          )
        })}
      </div>

      <p className="text-xs text-gray-500 mt-2">
        {selected.size === 0 ? 'Ningún día seleccionado' : `${selected.size} día${selected.size === 1 ? '' : 's'} seleccionado${selected.size === 1 ? '' : 's'}`}
      </p>
    </div>
  )
}
