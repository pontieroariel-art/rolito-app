import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getForecast } from '@/services/weatherService'
import { PLANTAS, PlantaId } from '@/types'

// Clima de hoy, compacto, para la cabecera del shell de escritorio: emoji +
// máxima de la planta del usuario (o Don Torcuato). Misma query y caché que
// ForecastStrip (ClimaPage), así no se pide dos veces.
export default function ClimaWidget({ planta, linkAClima }: { planta?: PlantaId; linkAClima: boolean }) {
  const p = planta ? PLANTAS[planta] : undefined
  const { data: days } = useQuery({
    queryKey: ['weather-forecast', p?.lat, p?.lng],
    queryFn:  () => getForecast(p?.lat, p?.lng),
    staleTime: 3_600_000,
  })
  const hoy = days?.[0]
  if (!hoy) return null
  const contenido = (
    <>
      <span aria-hidden>{hoy.emoji}</span>
      <span className="tabular-nums">{Math.round(hoy.tempMax)}°</span>
      {hoy.rain > 0 && <span className="text-sky-600 tabular-nums">{Math.round(hoy.rain)} mm</span>}
    </>
  )
  const titulo = `${hoy.label} · máx ${Math.round(hoy.tempMax)}° / mín ${Math.round(hoy.tempMin)}°${p ? ` · ${p.label}` : ''}`
  const clase = 'hidden sm:inline-flex items-center gap-1.5 text-xs text-gray-600 px-2 py-1 rounded-lg'
  return linkAClima
    ? <Link to="/admin/clima" title={titulo} className={`${clase} hover:bg-gray-50 hover:text-accent`}>{contenido}</Link>
    : <span title={titulo} className={clase}>{contenido}</span>
}
