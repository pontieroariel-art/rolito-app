import { useState, useEffect } from 'react'
import { getForecast, DayWeather } from '../../services/weatherService'

function tempColor(t: number): string {
  if (t >= 35) return '#ef4444'
  if (t >= 30) return '#f97316'
  if (t >= 25) return '#eab308'
  if (t >= 20) return '#84cc16'
  return '#60a5fa'
}

interface ClientWeatherProps {
  /** Coordenadas de la dirección del cliente; `null` = pronóstico de la planta. */
  coords: { lat: number; lng: number } | null
}

// Recibe las coordenadas hechas (las que logística corrigió en la dirección)
// en vez de geocodificar con Google Maps: así el home del cliente no baja el
// script de Maps solo para esto (2026-09-14).
export function ClientWeather({ coords }: ClientWeatherProps) {
  const [days,    setDays]    = useState<DayWeather[]>([])
  const [loading, setLoading] = useState(true)
  const [open,    setOpen]    = useState(false)
  const lat = coords?.lat
  const lng = coords?.lng

  useEffect(() => {
    // Guarda contra la carrera por cambio de sucursal: el pronóstico viejo no
    // pisa al nuevo si llega después.
    let vivo = true
    setLoading(true)
    getForecast(lat, lng)
      .then((d) => { if (vivo) setDays(d) })
      .catch(() => {})
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [lat, lng])

  const today = days[0]

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Cerrar pronóstico del clima' : 'Ver pronóstico del clima'}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {loading ? (
            <span className="text-secundario text-sm">Cargando clima...</span>
          ) : today ? (
            <>
              <span className="text-2xl leading-none">{today.emoji}</span>
              <div className="text-left">
                <p className="text-sm font-medium text-gray-900 leading-tight">
                  Hoy{' '}
                  <span style={{ color: tempColor(today.tempMax) }} className="font-bold">
                    {today.tempMax}°
                  </span>
                  <span className="text-secundario font-normal"> / {today.tempMin}°</span>
                  {today.rain > 0 && (
                    <span className="text-blue-500 text-xs ml-2">🌧️ {today.rain}mm</span>
                  )}
                </p>
                <p className="text-xs text-secundario">{today.label}</p>
              </div>
            </>
          ) : null}
        </div>
        <span className="text-secundario text-xs shrink-0 ml-2">{open ? '▲' : '▼ Semana'}</span>
      </button>

      {open && days.length > 0 && (
        <div className="border-t border-[#E7E5DC] px-4 py-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((d, i) => {
              const date = new Date(d.date + 'T12:00:00')
              return (
                <div
                  key={d.date}
                  className={`flex flex-col items-center gap-1 rounded-xl p-3 min-w-[68px] border shrink-0 ${
                    i === 0 ? 'bg-[#E8F5F0] border-[#B3DDD3]' : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <p className="text-xs text-secundario font-medium">
                    {i === 0 ? 'Hoy' : date.toLocaleDateString('es-AR', { weekday: 'short' })}
                  </p>
                  <p className="text-xl leading-none">{d.emoji}</p>
                  <p className="font-bold text-sm" style={{ color: tempColor(d.tempMax) }}>{d.tempMax}°</p>
                  <p className="text-xs text-secundario">{d.tempMin}°</p>
                  {d.rain > 0 && <p className="text-xs text-blue-500">{d.rain}mm</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
