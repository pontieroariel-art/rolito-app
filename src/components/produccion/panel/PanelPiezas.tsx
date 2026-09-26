import type { ReactNode } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Crown, Minus } from 'lucide-react'
import type { FilaOperario, FilaProducidoVendido } from '@/utils/panelProduccion'
import { PRODUCTOS_HIELO } from '@/utils/produccionCatalogo'

// Piezas visuales del panel del encargado de producción (2026-09-25).
// Pedido de Ariel: amigable y bien visual, los números grandes arriba.

export const CARD = 'bg-white border border-[#D3D1C7] rounded-2xl'
const fmt = (n: number) => n.toLocaleString('es-AR')

/** Variación contra ayer: flecha, color y porcentaje. */
export function Delta({ actual, antes, sufijo = 'que ayer a esta hora' }: { actual: number; antes: number; sufijo?: string }) {
  if (antes === 0 && actual === 0) return <span className="text-sm font-semibold text-secundario">Igual que ayer</span>
  if (antes === 0) return <span className="text-sm font-semibold text-[#0F6B4E]">Ayer no había nada a esta hora</span>
  const pct = Math.round(((actual - antes) / antes) * 100)
  const sube = pct > 0, igual = pct === 0
  const Icono = igual ? Minus : sube ? ArrowUpRight : ArrowDownRight
  const color = igual ? 'text-secundario' : sube ? 'text-[#0F6B4E]' : 'text-red-700'
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-bold ${color}`}>
      <Icono size={16} /> {igual ? 'Igual' : `${sube ? '+' : ''}${pct}%`} <span className="font-semibold text-secundario">{sufijo}</span>
    </span>
  )
}

/** Tarjeta de KPI: etiqueta, número grande, unidad y una línea de contexto. */
export function Kpi({ etiqueta, valor, unidad, pie, tono = 'normal', icono }: {
  etiqueta: string; valor: string | number; unidad?: string; pie?: ReactNode; tono?: 'normal' | 'alerta' | 'bien'; icono?: ReactNode
}) {
  const borde = tono === 'alerta' ? 'border-red-400 bg-red-50' : tono === 'bien' ? 'border-[#9FD8C3]' : ''
  return (
    <div className={`${CARD} ${borde} p-4 flex flex-col gap-1 min-w-0`}>
      <span className="flex items-center gap-2 text-xs font-bold tracking-wider text-secundario uppercase">{icono}{etiqueta}</span>
      <span className="flex items-baseline gap-2">
        <span className={`text-4xl font-black tabular-nums leading-none ${tono === 'alerta' ? 'text-red-700' : 'text-gray-900'}`}>
          {typeof valor === 'number' ? fmt(valor) : valor}
        </span>
        {unidad && <span className="text-base font-bold text-secundario">{unidad}</span>}
      </span>
      {pie && <span className="min-h-5">{pie}</span>}
    </div>
  )
}

/** Barras por hora: hoy (color) contra ayer (gris), en CSS (sin librería de gráficos). */
export function BarrasPorHora({ hoy, ayer, horaActual, leyenda = ['Este turno', 'Mismo turno ayer'] }: {
  hoy: { hora: string; pallets: number }[]; ayer: { pallets: number }[]; horaActual: number | null; leyenda?: [string, string]
}) {
  const max = Math.max(1, ...hoy.map((h) => h.pallets), ...ayer.map((h) => h.pallets))
  return (
    <div>
      <div className="flex items-end gap-2 h-40">
        {hoy.map((h, i) => (
          <div key={h.hora} className="flex-1 flex flex-col items-center justify-end gap-1 h-full min-w-0">
            <span className="text-xs font-bold tabular-nums text-gray-900">{h.pallets || ''}</span>
            <div className="w-full flex items-end justify-center gap-0.5 h-full">
              <div className="w-1/3 rounded-t bg-[#D3D1C7]" style={{ height: `${((ayer[i]?.pallets ?? 0) / max) * 100}%` }} title={`Ayer: ${ayer[i]?.pallets ?? 0}`} />
              <div className={`w-1/2 rounded-t ${i === horaActual ? 'bg-accent' : 'bg-[#6FC3A5]'}`} style={{ height: `${(h.pallets / max) * 100}%` }} title={`Hoy: ${h.pallets}`} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-1">
        {hoy.map((h, i) => (
          <span key={h.hora} className={`flex-1 text-center text-xs tabular-nums ${i === horaActual ? 'font-black text-gray-900' : 'text-secundario'}`}>{h.hora}</span>
        ))}
      </div>
      <div className="flex gap-4 mt-2 text-xs font-semibold text-secundario">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#6FC3A5]" /> {leyenda[0]}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#D3D1C7]" /> {leyenda[1]}</span>
      </div>
    </div>
  )
}

/** Equipo del turno: capitán, asignados y quién cargó cuánto. */
export function EquipoTurno({ equipo }: { equipo: FilaOperario[] }) {
  if (equipo.length === 0) {
    return <p className="text-sm text-secundario">Sin operarios asignados a este turno. Se asignan en Plantas → Turnos.</p>
  }
  const max = Math.max(1, ...equipo.map((f) => f.pallets))
  return (
    <ul className="flex flex-col gap-2">
      {equipo.map((f) => (
        <li key={f.uid} className="flex items-center gap-3">
          <span className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-black ${f.capitan ? 'bg-amber-100 text-amber-800' : 'bg-[#F1EFE8] text-gray-900'}`}>
            {f.capitan ? <Crown size={18} /> : f.nombre.slice(0, 1)}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-gray-900 truncate" title={f.nombre}>{f.nombre}</span>
              {f.capitan && <span className="text-xs font-bold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">Capitán</span>}
              {!f.asignado && <span className="text-xs font-bold text-secundario bg-[#F1EFE8] rounded-full px-2 py-0.5">No asignado</span>}
            </div>
            <div className="mt-1 h-2 rounded-full bg-[#F1EFE8] overflow-hidden">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(f.pallets / max) * 100}%` }} />
            </div>
          </div>
          <span className="w-20 text-right text-sm tabular-nums">
            <span className="text-xl font-black text-gray-900">{f.pallets}</span> <span className="text-secundario">pallets</span>
            {(f.anulados > 0 || f.repetidos > 0) && (
              <span className="block text-xs font-semibold text-amber-800">
                {f.anulados > 0 ? `${f.anulados} anul.` : ''}{f.anulados > 0 && f.repetidos > 0 ? ' · ' : ''}{f.repetidos > 0 ? `${f.repetidos} rep.` : ''}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Producido contra vendido por producto, con barras enfrentadas y el balance. */
export function ProducidoVendido({ filas }: { filas: FilaProducidoVendido[] }) {
  const max = Math.max(1, ...filas.flatMap((f) => [f.producidoPallets, f.vendidoPallets]))
  const totalProd = filas.reduce((s, f) => s + f.producidoPallets, 0)
  const totalVend = Math.round(filas.reduce((s, f) => s + f.vendidoPallets, 0) * 10) / 10
  const balance = Math.round((totalProd - totalVend) * 10) / 10
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-[#E6F5EF] p-3">
          <p className="text-xs font-bold text-[#0F6B4E] uppercase tracking-wider">Producido</p>
          <p className="text-3xl font-black tabular-nums text-gray-900">{fmt(totalProd)} <span className="text-base text-secundario">pallets</span></p>
        </div>
        <div className="rounded-xl bg-[#EEF2FA] p-3">
          <p className="text-xs font-bold text-[#2a5bb5] uppercase tracking-wider">Vendido</p>
          <p className="text-3xl font-black tabular-nums text-gray-900">{totalVend.toLocaleString('es-AR')} <span className="text-base text-secundario">pallets</span></p>
        </div>
        <div className={`rounded-xl p-3 ${balance >= 0 ? 'bg-[#E6F5EF]' : 'bg-red-50'}`}>
          <p className={`text-xs font-bold uppercase tracking-wider ${balance >= 0 ? 'text-[#0F6B4E]' : 'text-red-700'}`}>Stock</p>
          <p className={`text-3xl font-black tabular-nums ${balance >= 0 ? 'text-[#0F6B4E]' : 'text-red-700'}`}>
            {balance > 0 ? '+' : ''}{balance.toLocaleString('es-AR')}
          </p>
          <p className="text-xs font-semibold text-secundario">{balance > 0 ? 'Se levanta stock' : balance < 0 ? 'Se vende más de lo que se produce' : 'Parejo'}</p>
        </div>
      </div>
      <ul className="flex flex-col gap-3">
        {filas.map((f) => {
          const p = PRODUCTOS_HIELO[f.productoId]
          return (
            <li key={f.productoId} className="grid grid-cols-[7rem_1fr_6rem] items-center gap-3">
              <span className="font-black truncate" style={{ color: p.color }} title={p.nombre}>{p.etiquetaGrilla}</span>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <div className="h-3 rounded-full bg-accent" style={{ width: `${(f.producidoPallets / max) * 100}%`, minWidth: f.producidoPallets ? 6 : 0 }} />
                  <span className="text-xs font-bold tabular-nums text-gray-900">{f.producidoPallets}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 rounded-full bg-[#7E9BD6]" style={{ width: `${(f.vendidoPallets / max) * 100}%`, minWidth: f.vendidoPallets ? 6 : 0 }} />
                  <span className="text-xs font-bold tabular-nums text-gray-900">{f.vendidoPallets.toLocaleString('es-AR')}</span>
                </div>
              </div>
              <span className={`text-right text-sm font-black tabular-nums ${f.balancePallets > 0 ? 'text-[#0F6B4E]' : f.balancePallets < 0 ? 'text-red-700' : 'text-secundario'}`}>
                {f.balancePallets > 0 ? '▲ +' : f.balancePallets < 0 ? '▼ ' : ''}{f.balancePallets.toLocaleString('es-AR')}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="flex gap-4 text-xs font-semibold text-secundario">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-accent" /> Producido (pallets)</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#7E9BD6]" /> Vendido (en pallets)</span>
      </div>
    </div>
  )
}

/** Aviso destacado arriba del panel. */
export function Alerta({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border-2 border-red-400 bg-red-50 px-4 py-3">
      <AlertTriangle size={26} className="shrink-0 text-red-600" />
      <p className="text-base font-bold text-red-800">{children}</p>
    </div>
  )
}
