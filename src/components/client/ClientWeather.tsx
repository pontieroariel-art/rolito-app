import { useState, useEffect, useRef } from 'react'
import { getForecast, DayWeather } from '../../services/weatherService'

function tempColor(t: number): string {
  if (t >= 35) return '#ef4444'
  if (t >= 30) return '#f97316'
  if (t >= 25) return '#eab308'
  if (t >= 20) return '#84cc16'
  return '#60a5fa'
}

interface ClientWeatherProps {
  address:  string
  isLoaded: boolean
}

export function ClientWeather({ address, isLoaded }: ClientWeatherProps) {
  const [coords,  setCoords]  = useState<{ lat: number; lng: number } | null>(null)
  const [days,    setDays]    = useState<DayWeather[]>([])
  const [loading, setLoading] = useState(true)
  const [open,    setOpen]    = useState(false)
  const geocodedRef           = useRef(false)

  useEffect(() => {
    if (geocodedRef.current) return
    if (isLoaded && address) {
      geocodedRef.current = true
      new google.maps.Geocoder().geocode({ address }, (results, status) => {
        if (status === 'OK' && results?.[0]) {
          const loc = results[0].geometry.location
          setCoords({ lat: loc.lat(), lng: loc.lng() })
        } else {
          setCoords(null)
        }
      })
    } else if (!address) {
      setCoords(null)
    }
  }, [isLoaded, address])

  useEffect(() => {
    setLoading(true)
    getForecast(coords?.lat, coords?.lng)
      .then(setDays)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [coords])

  const today = days[0]

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Cerrar pronóstico del clima' : 'Ver pronóstico del clima'}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          {loading ? (
            <span className="text-muted text-sm">Cargando clima...</span>
          ) : today ? (
            <>
              <span className="text-2xl leading-none">{today.emoji}</span>
              <div className="text-left">
                <p className="text-sm font-medium leading-tight">
                  Hoy{' '}
                  <span style={{ color: tempColor(today.tempMax) }} className="font-bold">
                    {today.tempMax}°
                  </span>
                  <span className="text-muted font-normal"> / {today.tempMin}°</span>
                  {today.rain > 0 && (
                    <span className="text-blue-400 text-xs ml-2">🌧️ {today.rain}mm</span>
                  )}
                </p>
                <p className="text-xs text-muted">{today.label}</p>
              </div>
            </>
          ) : null}
        </div>
        <span className="text-muted text-xs shrink-0 ml-2">{open ? '▲' : '▼ Semana'}</span>
      </button>

      {open && days.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((d, i) => {
              const date = new Date(d.date + 'T12:00:00')
              return (
                <div
                  key={d.date}
                  className={`flex flex-col items-center gap-1 rounded-xl p-3 min-w-[68px] border shrink-0 ${
                    i === 0 ? 'bg-accent/10 border-accent/30' : 'bg-bg border-border/60'
                  }`}
                >
                  <p className="text-xs text-muted font-medium">
                    {i === 0 ? 'Hoy' : date.toLocaleDateString('es-AR', { weekday: 'short' })}
                  </p>
                  <p className="text-xl leading-none">{d.emoji}</p>
                  <p className="font-bold text-sm" style={{ color: tempColor(d.tempMax) }}>{d.tempMax}°</p>
                  <p className="text-xs text-muted">{d.tempMin}°</p>
                  {d.rain > 0 && <p className="text-xs text-blue-400">{d.rain}mm</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
