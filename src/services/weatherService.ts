const DEFAULT_LAT = -34.6037
const DEFAULT_LNG = -58.3816
const TZ          = 'America/Argentina/Buenos_Aires'

const DAILY_VARS = 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode'

export interface DayWeather {
  date:     string   // 'YYYY-MM-DD'
  tempMax:  number
  tempMin:  number
  rain:     number   // mm
  code:     number
  label:    string
  emoji:    string
}

// WMO weather interpretation codes → emoji + label
function interpretCode(code: number): { emoji: string; label: string } {
  if (code === 0)                       return { emoji: '☀️',  label: 'Despejado' }
  if (code <= 3)                        return { emoji: '⛅',  label: 'Parcialmente nublado' }
  if (code <= 48)                       return { emoji: '🌫️', label: 'Niebla' }
  if (code <= 55)                       return { emoji: '🌦️', label: 'Llovizna' }
  if (code <= 65)                       return { emoji: '🌧️', label: 'Lluvia' }
  if (code <= 75)                       return { emoji: '❄️',  label: 'Nieve' }
  if (code <= 82)                       return { emoji: '🌦️', label: 'Chubascos' }
  if (code === 95)                      return { emoji: '⛈️',  label: 'Tormenta' }
  if (code >= 96)                       return { emoji: '⛈️',  label: 'Tormenta con granizo' }
  return { emoji: '🌡️', label: 'Variable' }
}

function parseDays(data: any): DayWeather[] {
  const { time, temperature_2m_max, temperature_2m_min, precipitation_sum, weathercode } = data.daily
  return time.map((date: string, i: number) => {
    const code = weathercode[i]
    const { emoji, label } = interpretCode(code)
    return {
      date,
      tempMax: Math.round(temperature_2m_max[i]),
      tempMin: Math.round(temperature_2m_min[i]),
      rain:    Math.round((precipitation_sum[i] ?? 0) * 10) / 10,
      code,
      label,
      emoji,
    }
  })
}

export async function getForecast(lat = DEFAULT_LAT, lng = DEFAULT_LNG): Promise<DayWeather[]> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=${DAILY_VARS}&timezone=${TZ}&forecast_days=7`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Error al obtener pronóstico')
  return parseDays(await res.json())
}

export async function getHistoricalWeather(startDate: string, endDate: string, lat = DEFAULT_LAT, lng = DEFAULT_LNG): Promise<DayWeather[]> {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${startDate}&end_date=${endDate}&daily=${DAILY_VARS}&timezone=${TZ}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Error al obtener historial climático')
  return parseDays(await res.json())
}
