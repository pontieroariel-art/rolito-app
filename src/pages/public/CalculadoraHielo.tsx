import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Snowflake, Cloud, CloudSun, Sun, Info, Users, CalendarDays, Thermometer, Clock } from 'lucide-react'
import { getForecast } from '../../services/weatherService'

type Duracion = 'corta' | 'media' | 'larga'
type Temperatura = 'fresco' | 'templado' | 'caluroso'

// La referencia (1 kg/persona) es día templado + 4 a 6 hs: por eso "media" vale 1
// y el resto de las duraciones son proporcionales a esa regla.
const FACTOR_DURACION: Record<Duracion, number> = {
  corta: 0.8,
  media: 1,
  larga: 1.2,
}

const OPCIONES_DURACION: { value: Duracion; label: string; hint: string }[] = [
  { value: 'corta', label: 'Hasta 3 hs',  hint: 'Junta corta' },
  { value: 'media', label: '4 a 6 hs',    hint: 'Tarde/noche' },
  { value: 'larga', label: 'Más de 6 hs', hint: 'Todo el día' },
]

// El día templado es la referencia (1 kg/persona, la regla de siempre):
// queda en el medio de la escala, fresco resta y caluroso suma.
const FACTOR_TEMPERATURA: Record<Temperatura, number> = {
  fresco:   0.7,
  templado: 1,
  caluroso: 1.3,
}

const OPCIONES_TEMPERATURA: { value: Temperatura; label: string; hint: string; icon: typeof Cloud }[] = [
  { value: 'fresco',   label: 'Fresco',   hint: 'Hasta 22°', icon: Cloud },
  { value: 'templado', label: 'Templado', hint: '22° a 30°', icon: CloudSun },
  { value: 'caluroso', label: 'Caluroso', hint: 'Más de 30°', icon: Sun },
]

const FACTOR_BEBIDAS = 1.2

function clasificarTemperatura(tempMax: number): Temperatura {
  if (tempMax < 22) return 'fresco'
  if (tempMax < 30) return 'templado'
  return 'caluroso'
}

function fechaISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const DIAS_PRONOSTICO = 16

const HOY = new Date()
const ULTIMO_DIA_PRONOSTICO = new Date(HOY.getTime() + (DIAS_PRONOSTICO - 1) * 86_400_000)
const MIN_FECHA = fechaISO(HOY)
const MAX_FECHA_LARGA = ULTIMO_DIA_PRONOSTICO.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })

export default function CalculadoraHielo() {
  const [personas, setPersonas]   = useState(20)
  const [fecha, setFecha]         = useState(MIN_FECHA)
  const [duracion, setDuracion]   = useState<Duracion>('media')
  const [bebidas, setBebidas]     = useState(true)
  // null = seguir el pronóstico automáticamente; con valor = el usuario lo pisó a mano
  const [temperaturaManual, setTemperaturaManual] = useState<Temperatura | null>(null)

  useEffect(() => {
    document.title = 'Calculadora de Hielo - Rolito'
  }, [])

  // Si esta página está embebida en un iframe (ej. WordPress), le avisamos al
  // padre la altura real del contenido para que ajuste el iframe sin scroll doble.
  useEffect(() => {
    if (window.self === window.top) return
    const avisarAltura = () => {
      window.parent.postMessage(
        { type: 'rolito:calculadora-hielo:height', height: document.documentElement.scrollHeight },
        '*'
      )
    }
    const observer = new ResizeObserver(avisarAltura)
    observer.observe(document.documentElement)
    avisarAltura()
    return () => observer.disconnect()
  }, [])

  const { data: pronostico } = useQuery({
    queryKey:  ['pronostico-calculadora-hielo'],
    queryFn:   () => getForecast(undefined, undefined, DIAS_PRONOSTICO),
    staleTime: 30 * 60_000,
    retry:     1,
  })

  const diaPronosticado = pronostico?.find((d) => d.date === fecha)
  const temperaturaAuto = diaPronosticado ? clasificarTemperatura(diaPronosticado.tempMax) : null
  const temperatura = temperaturaManual ?? temperaturaAuto ?? 'templado'

  const kgNecesarios = useMemo(() => {
    if (!personas || personas < 1) return 0
    const factor = FACTOR_TEMPERATURA[temperatura] * FACTOR_DURACION[duracion] * (bebidas ? FACTOR_BEBIDAS : 1)
    return Math.ceil(personas * factor)
  }, [personas, temperatura, duracion, bebidas])

  return (
    <div className="min-h-screen bg-[#F8F7F2] flex flex-col">

      {/* Cabecera */}
      <div
        className="flex justify-center items-end pt-10 pb-0"
        style={{ background: 'linear-gradient(180deg, #1a6b52 0%, #1D9E75 100%)' }}
      >
        <div className="bg-white rounded-2xl p-2 shadow-lg mb-0 translate-y-1/2">
          <img src="/isotipo-rolito.png" alt="Rolito" className="w-16 h-16 object-contain" />
        </div>
      </div>

      {/* Logo */}
      <div className="bg-white flex flex-col items-center pt-12 pb-5 shadow-sm">
        <img src="/logo-rolito.png" alt="Rolito" className="h-16 object-contain" />
      </div>

      {/* Contenido */}
      <div className="flex-1 flex flex-col items-center px-4 pt-7 pb-10 gap-5">
        <div className="text-center max-w-sm">
          <div className="flex items-center justify-center gap-3">
            <Snowflake size={20} className="text-accent/50 animate-bob" style={{ animationDelay: '0s' }} />
            <h1 className="text-xl font-bold text-gray-900">Calculadora de hielo</h1>
            <Snowflake size={20} className="text-accent/50 animate-bob" style={{ animationDelay: '1.1s' }} />
          </div>
        </div>

        <div className="w-full max-w-sm bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-5 space-y-5 animate-fadeUp">

          {/* Personas */}
          <div>
            <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <Users size={14} className="text-accent" /> ¿Cuántas personas son?
            </label>
            <input
              type="number"
              min={1}
              value={personas}
              onChange={(e) => setPersonas(Math.max(0, Number(e.target.value)))}
              className="mt-2 w-full rounded-xl border border-[#D3D1C7] px-4 py-2.5 text-lg font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
            />
          </div>

          {/* Fecha */}
          <div>
            <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <CalendarDays size={14} className="text-accent" /> ¿Qué día es el evento?
            </label>
            <input
              type="date"
              min={MIN_FECHA}
              value={fecha}
              onChange={(e) => { setFecha(e.target.value); setTemperaturaManual(null) }}
              className="mt-2 w-full rounded-xl border border-[#D3D1C7] px-4 py-2.5 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
            />
            {diaPronosticado ? (
              <div className="mt-2 flex items-center gap-2 rounded-full bg-accent/10 border border-accent/20 px-3 py-1.5">
                <span className="text-base leading-none">{diaPronosticado.emoji}</span>
                <p className="text-xs font-semibold text-accent leading-tight">
                  Pronóstico: {diaPronosticado.label.toLowerCase()}, máxima de {diaPronosticado.tempMax}°
                  {temperaturaManual ? ' · ajustado a mano abajo' : ''}
                </p>
              </div>
            ) : (
              <div className="mt-2 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
                <Info size={15} className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 leading-snug">
                  Todavía no hay pronóstico para esta fecha (lo tenemos hasta el {MAX_FECHA_LARGA}) — elegí la
                  temperatura esperada vos mismo abajo.
                </p>
              </div>
            )}
          </div>

          {/* Temperatura */}
          <div>
            <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <Thermometer size={14} className="text-accent" /> ¿Qué temperatura esperás?
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {OPCIONES_TEMPERATURA.map((opt) => {
                const Icon = opt.icon
                const activo = temperatura === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTemperaturaManual(opt.value)}
                    className={`rounded-xl border px-2 py-2.5 text-center transition-colors ${
                      activo
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-[#D3D1C7] text-gray-500 hover:border-accent/50'
                    }`}
                  >
                    <Icon size={16} className="mx-auto mb-1" strokeWidth={1.75} />
                    <p className="text-xs font-bold leading-tight">{opt.label}</p>
                    <p className="text-[10px] mt-0.5 opacity-80 leading-tight">{opt.hint}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Duración */}
          <div>
            <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <Clock size={14} className="text-accent" /> ¿Cuánto dura la juntada?
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {OPCIONES_DURACION.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDuracion(opt.value)}
                  className={`rounded-xl border px-2 py-2.5 text-center transition-colors ${
                    duracion === opt.value
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-[#D3D1C7] text-gray-500 hover:border-accent/50'
                  }`}
                >
                  <p className="text-xs font-bold leading-tight">{opt.label}</p>
                  <p className="text-[10px] mt-0.5 opacity-80 leading-tight">{opt.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Bebidas */}
          <label className="flex items-center gap-3 rounded-xl border border-[#D3D1C7] px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={bebidas}
              onChange={(e) => setBebidas(e.target.checked)}
              className="w-4 h-4 accent-[#1D9E75]"
            />
            <span className="text-sm text-gray-700">Necesito hielo extra para enfriar bebidas</span>
          </label>
        </div>

        {/* Resultado */}
        <div className="w-full max-w-sm rounded-2xl p-5 text-center text-white shadow-lg" style={{ background: 'linear-gradient(180deg, #1a6b52 0%, #1D9E75 100%)' }}>
          <div className="flex items-center justify-center gap-2 opacity-90">
            <Snowflake size={18} />
            <p className="text-xs font-semibold uppercase tracking-widest">Necesitás aproximadamente</p>
          </div>
          <p key={kgNecesarios} className="text-4xl font-extrabold mt-1 animate-rise">{kgNecesarios} kg</p>
        </div>

        <p className="text-[11px] text-gray-400 text-center max-w-sm">
          Cálculo estimado a modo orientativo. Para eventos muy grandes o clima extremo, sumá un margen extra.
        </p>
      </div>
    </div>
  )
}
