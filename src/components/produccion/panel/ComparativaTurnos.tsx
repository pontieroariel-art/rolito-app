import { Crown, Trophy } from 'lucide-react'
import type { FilaCapitan, FilaComparativaTurno } from '@/utils/panelProduccion'
import { CARD } from './PanelPiezas'

// Comparativa de turnos (2026-09-26, pedido de Ariel: "que los turnos
// compitan entre sí"). Podio por pallets, con kilos, ritmo por hora
// trabajada (no es justo comparar solo totales si un turno dura más), el
// capitán que estuvo al frente y la evolución día por día. Abajo, el ranking
// de capitanes por promedio de pallets en los turnos que dirigieron.

const PUESTO = [
  { fondo: 'bg-amber-50 border-amber-300', chip: 'bg-amber-400 text-white', texto: '1°' },
  { fondo: 'bg-[#F3F4F6] border-[#C9CDD3]', chip: 'bg-[#9AA1AB] text-white', texto: '2°' },
  { fondo: 'bg-[#FBF1EA] border-[#E4B994]', chip: 'bg-[#C98B5A] text-white', texto: '3°' },
]

function MiniBarras({ valores, etiquetas }: { valores: number[]; etiquetas: string[] }) {
  const max = Math.max(1, ...valores)
  return (
    <div className="flex items-end gap-0.5 h-12" aria-label="Pallets por día">
      {valores.map((v, i) => (
        <div key={i} className="flex-1 h-full flex items-end" title={`${etiquetas[i]}: ${v} pallets`}>
          <div className="w-full rounded-t bg-accent/80" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 3 : 1, opacity: v ? 1 : 0.25 }} />
        </div>
      ))}
    </div>
  )
}

export default function ComparativaTurnos({ turnos, capitanes, dias }: {
  turnos: FilaComparativaTurno[]; capitanes: FilaCapitan[]; dias: string[]
}) {
  const hayDatos = turnos.some((t) => t.pallets > 0)
  const max = Math.max(1, ...turnos.map((t) => t.pallets))
  const etiquetas = dias.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7))

  if (!hayDatos) return <p className="text-sm text-secundario">Todavía no hay pallets en este período para comparar.</p>

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        {turnos.map((t, i) => {
          const p = PUESTO[i]
          return (
            <div key={t.nombre} className={`rounded-2xl border-2 p-4 flex flex-col gap-3 ${p?.fondo ?? 'bg-white border-[#E7E5DC]'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-black ${p?.chip ?? 'bg-[#F1EFE8] text-gray-900'}`}>{p?.texto ?? `${i + 1}°`}</span>
                  <span className="text-xl font-black text-gray-900">{t.nombre}</span>
                </span>
                {i === 0 && t.pallets > 0 && <Trophy size={26} className="text-amber-500" />}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black tabular-nums text-gray-900">{t.pallets}</span>
                <span className="text-base font-bold text-secundario">pallets</span>
              </div>
              <div className="h-2.5 rounded-full bg-white/70 overflow-hidden">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(t.pallets / max) * 100}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-lg font-black tabular-nums">{t.kilos.toLocaleString('es-AR')}</p><p className="text-xs font-bold text-secundario">kg</p></div>
                <div><p className="text-lg font-black tabular-nums">{t.palletsPorHora.toLocaleString('es-AR')}</p><p className="text-xs font-bold text-secundario">por hora</p></div>
                <div><p className={`text-lg font-black tabular-nums ${t.anulados ? 'text-amber-700' : ''}`}>{t.anulados}</p><p className="text-xs font-bold text-secundario">anulados</p></div>
              </div>
              {dias.length > 1 && <MiniBarras valores={t.porDia} etiquetas={etiquetas} />}
              <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                <Crown size={16} className="text-amber-600" />
                {t.capitan ?? <span className="text-secundario">Sin capitán asignado</span>}
                <span className="ml-auto text-xs text-secundario">{t.turnosTrabajados} turno{t.turnosTrabajados === 1 ? '' : 's'}</span>
              </p>
            </div>
          )
        })}
      </div>

      {capitanes.length > 0 && (
        <div className={`${CARD} p-4`}>
          <h3 className="flex items-center gap-2 text-xs font-bold tracking-wider text-secundario uppercase mb-3"><Crown size={14} /> Capitanes · promedio de pallets por turno al frente</h3>
          <ul className="space-y-2">
            {capitanes.map((c, i) => {
              const maxProm = Math.max(1, ...capitanes.map((x) => x.promedioPorTurno))
              return (
                <li key={c.uid} className="grid grid-cols-[2rem_minmax(0,12rem)_1fr_9rem] items-center gap-3">
                  <span className="text-sm font-black text-secundario tabular-nums">{i + 1}°</span>
                  <span className="font-bold text-gray-900 truncate" title={c.nombre}>{c.nombre}</span>
                  <div className="h-3 rounded-full bg-[#F1EFE8] overflow-hidden"><div className="h-full rounded-full bg-amber-400" style={{ width: `${(c.promedioPorTurno / maxProm) * 100}%` }} /></div>
                  <span className="text-right text-sm tabular-nums">
                    <b className="text-lg">{c.promedioPorTurno.toLocaleString('es-AR')}</b> <span className="text-secundario">por turno · {c.turnos} t.</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
