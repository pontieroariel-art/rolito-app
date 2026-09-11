import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Tono } from '@/utils/backofficeEstado'

// Tile del panel de control del super_admin (2026-09-10): mismo esqueleto que
// el `Tile` de TesoreriaLivePage (borde superior de color, título uppercase,
// número grande, líneas clave/valor, link), con el color tomado del tono.

export const COLOR_TONO: Record<Tono, string> = {
  ok:       '#0F6B4E',
  atencion: '#B45309',
  error:    '#B91C1C',
  neutro:   '#6B7280',
}

export const TEXTO_TONO: Record<Tono, string> = {
  ok:       'Al día',
  atencion: 'Requiere atención',
  error:    'Con problemas',
  neutro:   'Sin dato',
}

export interface TileEstadoProps {
  titulo:    string
  tono:      Tono
  /** Número grande (o texto corto). `null` = todavía sin dato. */
  valor:     number | string | null
  sufijo?:   string
  lineas?:   Array<[string, ReactNode]>
  to?:       string
  toLabel?:  string
  children?: ReactNode
}

export default function TileEstado({ titulo, tono, valor, sufijo, lineas = [], to, toLabel = 'Ver', children }: TileEstadoProps) {
  const color = COLOR_TONO[tono]
  return (
    <div className="rounded-xl border border-[#D3D1C7] bg-white p-3 space-y-1.5 flex flex-col" style={{ borderTop: `4px solid ${color}` }}>
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{titulo}</p>
      <p className="text-2xl font-bold text-gray-900 tabular-nums leading-tight">
        {valor === null ? <span className="text-gray-300">—</span> : valor}
        {sufijo && valor !== null && <span className="text-sm font-medium text-gray-500 ml-1">{sufijo}</span>}
      </p>
      {lineas.length > 0 && (
        <div className="text-xs text-gray-600 space-y-0.5">
          {lineas.map(([k, v]) => (
            <p key={k} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">{k}</span>
              <b className="text-gray-800 tabular-nums shrink-0">{v}</b>
            </p>
          ))}
        </div>
      )}
      {children}
      {to && <Link to={to} className="block text-xs text-accent underline underline-offset-2 mt-auto pt-1">{toLabel}</Link>}
    </div>
  )
}
