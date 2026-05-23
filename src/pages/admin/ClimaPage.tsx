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
    const d = o.date?.toDate ? o.date.toDate() : new Date((o.date as any)?.seconds * 1000)
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
    <div className="bg-bg border border-border rounded-xl p-3 text-sm space-y-1 shadow-xl">
      <p className="font-semibold text-white">{label}</p>
      {temp  && <p style={{ color: temp.color  }}>🌡️ {temp.value}°C máx</p>}
      {rain  && rain.value > 0 && <p className="text-blue-400">🌧️ {rain.value} mm</p>}
      {units && <p style={{ color: units.color }}>📦 {units.value} unidades</p>}
    </div>
  )
}

// ── ForecastStrip ─────────────────────────────────────────────────────────────

export function ForecastStrip() {
  const { data: days = [], isLoading } = useQuery({
    queryKey: ['weather-forecast'],
    queryFn:  () => getForecast(),
    staleTime: 3_600_000,
  })

  if (isLoading) return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="bg-surface border border-border rounded-xl p-3 min-w-[80px] h-24 animate-pulse" />
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
              isToday ? 'bg-accent/10 border-accent/40' : 'bg-surface border-border'
            }`}
          >
            <p className="text-xs text-muted font-medium">
              {isToday ? 'Hoy' : date.toLocaleDateString('es-AR', { weekday: 'short' })}
            </p>
            <p className="text-2xl leading-none">{d.emoji}</p>
            <p className="font-bold text-sm" style={{ color: tempColor(d.tempMax) }}>{d.tempMax}°</p>
            <p className="text-xs text-muted">{d.tempMin}°</p>
            {d.rain > 0 && (
              <p className="text-xs text-blue-400">{d.rain}mm</p>
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
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  const { start, end, startDate, endDate } = monthBounds(year, month)
  const monthLabel = new Date(year, month, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  const localDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const { data: weatherDays = [], isLoading: loadingW, isError: errorW, error: errW } = useQuery({
    queryKey: ['weather-history', start, end],
    queryFn:  () => getHistoricalWeather(start, isCurrentMonth ? localDateStr(now) : end),
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
    <>
      <Navbar />
      <main className="max-w-4xl mx-auto p-4 space-y-6 pb-10">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Clima — Buenos Aires</h1>
          <p className="text-muted text-sm mt-0.5">Pronóstico e historial para planificar la temporada</p>
        </div>

        {/* Pronóstico 7 días */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wide">Próximos 7 días</h2>
          <ForecastStrip />
        </section>

        {/* Historial mensual */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-wide capitalize">
              Historial — {monthLabel}
            </h2>
            <div className="flex items-center gap-1">
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-surface border border-transparent hover:border-border transition-colors">
                <ChevronLeft size={16} />
              </button>
              <button onClick={nextMonth} disabled={isCurrentMonth} className="p-1.5 rounded-lg hover:bg-surface border border-transparent hover:border-border transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* KPIs del mes */}
          {!isLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-surface border border-border rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted">
                  <Thermometer size={14} />
                  <p className="text-xs uppercase tracking-wide">Temp. máx. pico</p>
                </div>
                <p className="text-2xl font-bold" style={{ color: tempColor(maxTemp) }}>{maxTemp}°C</p>
              </div>
              <div className="bg-surface border border-border rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted">
                  <Thermometer size={14} />
                  <p className="text-xs uppercase tracking-wide">Temp. media</p>
                </div>
                <p className="text-2xl font-bold" style={{ color: tempColor(avgTemp) }}>{avgTemp}°C</p>
              </div>
              <div className="bg-surface border border-border rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted">
                  <Droplets size={14} />
                  <p className="text-xs uppercase tracking-wide">Días de lluvia</p>
                </div>
                <p className="text-2xl font-bold text-blue-400">{rainDays}</p>
              </div>
              <div className="bg-surface border border-border rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted">
                  <CloudSun size={14} />
                  <p className="text-xs uppercase tracking-wide">Unidades entregadas</p>
                </div>
                <p className="text-2xl font-bold text-accent">{totalUnidades.toLocaleString('es-AR')}</p>
              </div>
            </div>
          )}

          {/* Gráfico correlación */}
          <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">
              Temperatura máxima vs. unidades entregadas
            </p>
            {isLoading ? <div className="flex items-center justify-center h-56"><LoadingSpinner /></div> : errorW ? (
              <p className="text-center text-red-400 text-sm py-10">
                Error al cargar datos: {(errW as Error)?.message ?? 'Error desconocido'}
              </p>
            ) : (
              chartData.length === 0 ? (
                <p className="text-center text-muted text-sm py-10">Sin datos para este período</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" vertical={false} />
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
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-muted text-xs py-3 px-4 font-medium">Fecha</th>
                    <th className="text-center text-muted text-xs py-3 px-2 font-medium">Clima</th>
                    <th className="text-right text-muted text-xs py-3 px-4 font-medium">Máx</th>
                    <th className="text-right text-muted text-xs py-3 px-4 font-medium">Mín</th>
                    <th className="text-right text-muted text-xs py-3 px-4 font-medium">Lluvia</th>
                    <th className="text-right text-muted text-xs py-3 px-4 font-medium">Unidades</th>
                  </tr>
                </thead>
                <tbody>
                  {weatherDays.map((d) => {
                    const units = salesByDay[d.date] ?? 0
                    return (
                      <tr key={d.date} className="border-b border-border/40 last:border-0 hover:bg-white/[0.02] transition-colors">
                        <td className="py-2.5 px-4 text-muted">{shortDay(d.date)}</td>
                        <td className="py-2.5 px-2 text-center" title={d.label}>{d.emoji}</td>
                        <td className="py-2.5 px-4 text-right font-medium" style={{ color: tempColor(d.tempMax) }}>
                          {d.tempMax}°
                        </td>
                        <td className="py-2.5 px-4 text-right text-muted">{d.tempMin}°</td>
                        <td className="py-2.5 px-4 text-right text-blue-400">
                          {d.rain > 0 ? `${d.rain}mm` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {units > 0 ? (
                            <span className="font-medium text-accent">{units}</span>
                          ) : (
                            <span className="text-muted">—</span>
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
    </>
  )
}
