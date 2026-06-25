import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Bar, Cell, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { ChevronLeft, ChevronRight, Thermometer, Droplets, CloudSun } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { getForecast, getHistoricalWeather, DayWeather } from '../../services/weatherService'
import { getOrdersInRange } from '../../services/orderService'
import { Order } from '../../types'
import { tsToDate } from '../../utils/helpers'

// ── Ciudades ──────────────────────────────────────────────────────────────────

const CIUDADES = [
  { id: 'bsas',   label: 'Buenos Aires',  lat: -34.6037, lng: -58.3816 },
  { id: 'mdp',    label: 'Mar del Plata', lat: -38.0023, lng: -57.5575 },
  { id: 'tandil', label: 'Tandil',        lat: -37.3217, lng: -59.1332 },
  { id: 'rosario',label: 'Rosario',       lat: -32.9468, lng: -60.6393 },
] as const

type CiudadId = typeof CIUDADES[number]['id']

// ── helpers ───────────────────────────────────────────────────────────────────

function tempColor(t: number): string {
  if (t >= 35) return '#ef4444'
  if (t >= 30) return '#f97316'
  if (t >= 25) return '#eab308'
  if (t >= 20) return '#84cc16'
  return '#60a5fa'
}

function monthBounds(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(year, month + 1, 0).getDate()
  return {
    start: `${year}-${pad(month + 1)}-01`,
    end:   `${year}-${pad(month + 1)}-${pad(lastDay)}`,
    startDate: new Date(year, month, 1, 0, 0, 0),
    endDate:   new Date(year, month + 1, 0, 23, 59, 59),
  }
}

function unitsPerDay(orders: Order[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const o of orders) {
    if (o.status !== 'entregado') continue
    const d = tsToDate(o.date)
    const key = d.toISOString().split('T')[0]
    map[key] = (map[key] ?? 0) + o.products.reduce((s, p) => s + (p.quantity ?? 0), 0)
  }
  return map
}

function shortDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

// ── custom tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const temp  = payload.find((p: any) => p.dataKey === 'tempMax')
  const units = payload.find((p: any) => p.dataKey === 'unidades')
  const rain  = payload.find((p: any) => p.dataKey === 'rain')
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 text-sm space-y-1 shadow-lg">
      <p className="font-semibold text-gray-900">{label}</p>
      {temp  && <p style={{ color: temp.color  }}>🌡️ {temp.value}°C máx</p>}
      {rain  && rain.value > 0 && <p className="text-blue-500">🌧️ {rain.value} mm</p>}
      {units && <p style={{ color: units.color }}>📦 {units.value} unidades</p>}
    </div>
  )
}

// ── ForecastStrip ─────────────────────────────────────────────────────────────

export function ForecastStrip({ lat, lng }: { lat?: number; lng?: number } = {}) {
  const { data: days = [], isLoading } = useQuery({
    queryKey: ['weather-forecast', lat, lng],
    queryFn:  () => getForecast(lat, lng),
    staleTime: 3_600_000,
  })

  if (isLoading) return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="bg-gray-100 border border-[#D3D1C7] rounded-xl p-3 min-w-[80px] h-24 animate-pulse" />
      ))}
    </div>
  )

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
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
            <p className="text-xs text-gray-500 font-medium">
              {isToday ? 'Hoy' : date.toLocaleDateString('es-AR', { weekday: 'short' })}
            </p>
            <p className="text-2xl leading-none">{d.emoji}</p>
            <p className="font-bold text-sm" style={{ color: tempColor(d.tempMax) }}>{d.tempMax}°</p>
            <p className="text-xs text-gray-500">{d.tempMin}°</p>
            {d.rain > 0 && (
              <p className="text-xs text-blue-500">{d.rain}mm</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ClimaPage() {
  const now = new Date()
  const [year,    setYear]    = useState(now.getFullYear())
  const [month,   setMonth]   = useState(now.getMonth())
  const [ciudadId, setCiudadId] = useState<CiudadId>('bsas')

  const ciudad = CIUDADES.find((c) => c.id === ciudadId) ?? CIUDADES[0]

  const { start, end, startDate, endDate } = monthBounds(year, month)
  const monthLabel = new Date(year, month, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  const localDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const { data: weatherDays = [], isLoading: loadingW, isError: errorW, error: errW } = useQuery({
    queryKey: ['weather-history', start, end, ciudad.lat, ciudad.lng],
    queryFn:  () => getHistoricalWeather(start, isCurrentMonth ? localDateStr(now) : end, ciudad.lat, ciudad.lng),
    staleTime: isCurrentMonth ? 3_600_000 : Infinity,
    retry: 1,
  })

  const { data: orders = [], isLoading: loadingO } = useQuery({
    queryKey: ['orders-range', start, end],
    queryFn:  () => getOrdersInRange(startDate, endDate),
    staleTime: isCurrentMonth ? 300_000 : Infinity,
  })

  const isLoading = loadingW || loadingO

  const salesByDay = useMemo(() => unitsPerDay(orders), [orders])

  const chartData = useMemo(() => weatherDays.map((d) => ({
    label:    shortDay(d.date),
    date:     d.date,
    tempMax:  d.tempMax,
    tempMin:  d.tempMin,
    rain:     d.rain,
    unidades: salesByDay[d.date] ?? 0,
    emoji:    d.emoji,
    fill:     tempColor(d.tempMax),
  })), [weatherDays, salesByDay])

  const maxTemp  = useMemo(() => Math.max(...weatherDays.map((d) => d.tempMax), 0), [weatherDays])
  const avgTemp  = useMemo(() => weatherDays.length ? Math.round(weatherDays.reduce((s, d) => s + d.tempMax, 0) / weatherDays.length) : 0, [weatherDays])
  const rainDays = useMemo(() => weatherDays.filter((d) => d.rain > 1).length, [weatherDays])
  const totalUnidades = useMemo(() => Object.values(salesByDay).reduce((s, v) => s + v, 0), [salesByDay])

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    if (isCurrentMonth) return
    if (month === 11) { setYear((y) => y + 1); setMonth(0) }
    else setMonth((m) => m + 1)
  }

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-4xl mx-auto p-4 space-y-6 pb-10">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Clima — {ciudad.label}</h1>
            <p className="text-gray-500 text-sm mt-0.5">Pronóstico e historial para planificar la temporada</p>
          </div>
          {/* Selector de ciudad */}
          <div className="flex gap-1.5 flex-wrap">
            {CIUDADES.map((c) => (
              <button
                key={c.id}
                onClick={() => setCiudadId(c.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                  ciudadId === c.id
                    ? 'bg-accent text-white border-accent'
                    : 'bg-white text-gray-600 border-[#D3D1C7] hover:border-accent/50'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Pronóstico 7 días */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Próximos 7 días</h2>
          <ForecastStrip lat={ciudad.lat} lng={ciudad.lng} />
        </section>

        {/* Historial mensual */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide capitalize">
              Historial — {monthLabel}
            </h2>
            <div className="flex items-center gap-1">
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 border border-transparent hover:border-gray-200 transition-colors">
                <ChevronLeft size={16} />
              </button>
              <button onClick={nextMonth} disabled={isCurrentMonth} className="p-1.5 rounded-lg hover:bg-gray-100 border border-transparent hover:border-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* KPIs del mes */}
          {!isLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-gray-500">
                  <Thermometer size={14} />
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Temp. máx. pico</p>
                </div>
                <p className="text-2xl font-bold" style={{ color: tempColor(maxTemp) }}>{maxTemp}°C</p>
              </div>
              <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-gray-500">
                  <Thermometer size={14} />
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Temp. media</p>
                </div>
                <p className="text-2xl font-bold" style={{ color: tempColor(avgTemp) }}>{avgTemp}°C</p>
              </div>
              <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-gray-500">
                  <Droplets size={14} />
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Días de lluvia</p>
                </div>
                <p className="text-2xl font-bold text-blue-400">{rainDays}</p>
              </div>
              <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-gray-500">
                  <CloudSun size={14} />
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Unidades entregadas</p>
                </div>
                <p className="text-2xl font-bold text-accent">{totalUnidades.toLocaleString('es-AR')}</p>
              </div>
            </div>
          )}

          {/* Gráfico correlación */}
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Temperatura máxima vs. unidades entregadas
            </p>
            {isLoading ? <div className="flex items-center justify-center h-56"><LoadingSpinner /></div> : errorW ? (
              <p className="text-center text-red-400 text-sm py-10">
                Error al cargar datos: {(errW as Error)?.message ?? 'Error desconocido'}
              </p>
            ) : (
              chartData.length === 0 ? (
                <p className="text-center text-gray-500 text-sm py-10">Sin datos para este período</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval={chartData.length > 20 ? 4 : chartData.length > 10 ? 1 : 0}
                    />
                    <YAxis
                      yAxisId="temp"
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      unit="°"
                      domain={[0, 'auto']}
                    />
                    <YAxis
                      yAxisId="units"
                      orientation="right"
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      formatter={(v) => v === 'tempMax' ? 'Temp. máx (°C)' : 'Unidades entregadas'}
                      wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
                    />
                    <Bar
                      yAxisId="temp"
                      dataKey="tempMax"
                      name="tempMax"
                      maxBarSize={20}
                      radius={[3, 3, 0, 0]}
                      fill="#f97316"
                    >
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                    <Line
                      yAxisId="units"
                      dataKey="unidades"
                      name="unidades"
                      stroke="#00C2FF"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#00C2FF', strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )
            )}
          </div>

          {/* Tabla historial */}
          {!isLoading && weatherDays.length > 0 && (
            <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#D3D1C7]">
                    <th className="text-left text-gray-500 text-xs py-3 px-4 font-medium">Fecha</th>
                    <th className="text-center text-gray-500 text-xs py-3 px-2 font-medium">Clima</th>
                    <th className="text-right text-gray-500 text-xs py-3 px-4 font-medium">Máx</th>
                    <th className="text-right text-gray-500 text-xs py-3 px-4 font-medium">Mín</th>
                    <th className="text-right text-gray-500 text-xs py-3 px-4 font-medium">Lluvia</th>
                    <th className="text-right text-gray-500 text-xs py-3 px-4 font-medium">Unidades</th>
                  </tr>
                </thead>
                <tbody>
                  {weatherDays.map((d) => {
                    const units = salesByDay[d.date] ?? 0
                    return (
                      <tr key={d.date} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                        <td className="py-2.5 px-4 text-gray-500">{shortDay(d.date)}</td>
                        <td className="py-2.5 px-2 text-center" title={d.label}>{d.emoji}</td>
                        <td className="py-2.5 px-4 text-right font-medium" style={{ color: tempColor(d.tempMax) }}>
                          {d.tempMax}°
                        </td>
                        <td className="py-2.5 px-4 text-right text-gray-500">{d.tempMin}°</td>
                        <td className="py-2.5 px-4 text-right text-blue-500">
                          {d.rain > 0 ? `${d.rain}mm` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {units > 0 ? (
                            <span className="font-medium text-accent">{units}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
