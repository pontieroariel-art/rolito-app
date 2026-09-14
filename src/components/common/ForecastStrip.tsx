import { useQuery } from '@tanstack/react-query'
import { getForecast } from '@/services/weatherService'

// Tira de 7 días de pronóstico. Vivía adentro de ClimaPage.tsx, pero esa
// pantalla importa recharts estático: cada home que mostraba la tira (Resumen
// de logística, Tablero comercial) arrastraba el chunk `charts` (108 KB gz)
// al montar, aunque el gráfico estuviera en lazy. Acá no hay recharts
// (auditoría de bundle 2026-09-14). Misma query y caché que ClimaWidget.

export function tempColor(t: number): string {
  if (t >= 35) return '#ef4444'
  if (t >= 30) return '#f97316'
  if (t >= 25) return '#eab308'
  if (t >= 20) return '#84cc16'
  return '#60a5fa'
}

const SCROLL = 'flex gap-2 overflow-x-auto pb-2 [&::-webkit-scrollbar]:h-[3px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 hover:[&::-webkit-scrollbar-thumb]:bg-gray-400'
const SCROLL_STYLE = { scrollbarWidth: 'thin', scrollbarColor: '#d1d5db transparent' } as const

export function ForecastStrip({ lat, lng }: { lat?: number; lng?: number } = {}) {
  const { data: days = [], isLoading } = useQuery({
    queryKey: ['weather-forecast', lat, lng],
    queryFn:  () => getForecast(lat, lng),
    staleTime: 3_600_000,
  })

  if (isLoading) return (
    <div className={SCROLL} style={SCROLL_STYLE}>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="bg-gray-100 border border-[#D3D1C7] rounded-xl p-3 min-w-[80px] h-24 animate-pulse" />
      ))}
    </div>
  )

  return (
    <div className={SCROLL} style={SCROLL_STYLE}>
      {days.map((d, i) => {
        const date = new Date(d.date + 'T12:00:00')
        const isToday = i === 0
        return (
          <div
            key={d.date}
            className={`flex flex-col items-center gap-1 rounded-xl p-3 min-w-[80px] border transition-colors shrink-0 ${
              isToday ? 'bg-accent/10 border-accent/40' : 'bg-white border-[#D3D1C7]'
            }`}
          >
            <p className="text-xs text-secundario font-medium">
              {isToday ? 'Hoy' : date.toLocaleDateString('es-AR', { weekday: 'short' })}
            </p>
            <p className="text-2xl leading-none">{d.emoji}</p>
            <p className="font-bold text-sm" style={{ color: tempColor(d.tempMax) }}>{d.tempMax}°</p>
            <p className="text-xs text-secundario">{d.tempMin}°</p>
            {d.rain > 0 && (
              <p className="text-xs text-blue-500">{d.rain}mm</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
