import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { Package, Layers, TrendingUp } from 'lucide-react'
import LoadingSpinner from '../ui/LoadingSpinner'
import { useProduccionResumen, PeriodoResumen } from '../../hooks/useProduccionResumen'
import { PLANTAS, PlantaId } from '../../types'
import { PRODUCTOS_HIELO_LIST } from '../../utils/produccionCatalogo'

const PERIODOS: { id: PeriodoResumen; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7d',  label: '7 días' },
  { id: '30d', label: '30 días' },
]

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
      <p className="text-xs text-gray-500 flex items-center gap-1.5">{icon}{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value.toLocaleString('es-AR')}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

export function ProduccionResumen() {
  const [periodo, setPeriodo] = useState<PeriodoResumen>('hoy')
  const { pallets, loading } = useProduccionResumen(periodo)

  const totalUnidades = useMemo(() => pallets.reduce((s, p) => s + p.unidades, 0), [pallets])

  const porPlanta = useMemo(() => {
    const m: Record<PlantaId, { unidades: number; pallets: number }> = {
      torcuato: { unidades: 0, pallets: 0 },
      merlo:    { unidades: 0, pallets: 0 },
    }
    pallets.forEach((p) => {
      m[p.plantaId].unidades += p.unidades
      m[p.plantaId].pallets  += 1
    })
    return m
  }, [pallets])

  const porProducto = useMemo(() => {
    const map = new Map<string, number>()
    pallets.forEach((p) => map.set(p.productoId, (map.get(p.productoId) ?? 0) + p.unidades))
    return PRODUCTOS_HIELO_LIST
      .map((prod) => ({ ...prod, unidades: map.get(prod.id) ?? 0 }))
      .filter((p) => p.unidades > 0)
      .sort((a, b) => b.unidades - a.unidades)
  }, [pallets])

  // Serie por día — clave 'yyyy-MM-dd' con el mismo criterio (.toISOString().slice(0,10))
  // que ya usa el filtro de fecha de ProduccionListadoPage, para quedar consistentes.
  const porDia = useMemo(() => {
    const map = new Map<string, number>()
    pallets.forEach((p) => {
      const key = p.fechaFabricacion.toDate().toISOString().slice(0, 10)
      map.set(key, (map.get(key) ?? 0) + p.unidades)
    })
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fecha, unidades]) => ({
        dia: new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }),
        unidades,
      }))
  }, [pallets])

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Resumen</h2>
        <div className="flex gap-1.5">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriodo(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                periodo === p.id ? 'bg-accent text-white' : 'bg-[#F1EFE8] text-gray-600 hover:bg-[#E8E6DF]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : pallets.length === 0 ? (
        <div className="bg-white border border-[#D3D1C7] rounded-xl p-6 text-center">
          <p className="text-gray-400 text-sm">Sin producción cargada en este período.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard icon={<Package size={12} />} label="Total unidades" value={totalUnidades} sub="bolsas + barras" />
            <KpiCard icon={<Layers size={12} />} label="Total pallets" value={pallets.length} />
            <KpiCard icon={<Package size={12} />} label={PLANTAS.torcuato.label} value={porPlanta.torcuato.unidades} sub={`${porPlanta.torcuato.pallets} pallets`} />
            <KpiCard icon={<Package size={12} />} label={PLANTAS.merlo.label} value={porPlanta.merlo.unidades} sub={`${porPlanta.merlo.pallets} pallets`} />
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 min-w-0 overflow-hidden">
              <p className="text-sm font-medium mb-4 flex items-center gap-2 text-gray-900">
                <TrendingUp size={14} className="text-accent" />
                Unidades producidas por día
              </p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={porDia} margin={{ top: 4, right: 20, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fill: '#9CA3AF', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#ffffff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#6B7280' }}
                    itemStyle={{ color: '#1D9E75' }}
                    cursor={{ fill: 'rgba(29,158,117,0.06)' }}
                  />
                  <Bar dataKey="unidades" name="Unidades" fill="#1D9E75" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 min-w-0 overflow-hidden">
              <p className="text-sm font-medium mb-3 text-gray-900">Por producto</p>
              <div className="space-y-2">
                {porProducto.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 truncate">{p.nombre}</span>
                    <span className="text-gray-900 font-medium tabular-nums shrink-0 ml-2">
                      {p.unidades.toLocaleString('es-AR')} {p.unidadLabel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
