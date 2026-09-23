import { MapPin } from 'lucide-react'
import { etiquetaSucursal, sucursalesDe } from '@/utils/sucursalesTango'
import type { EmpresaTango, UserProfile } from '@/types'

// Cuentas con varias sucursales en Tango (un código por sucursal): antes de
// vender hay que elegir a cuál va. Se muestra solo si hay más de un código en
// la empresa del canal; con uno solo no aparece y se usa ese.
export default function SelectorSucursal({ cliente, empresa, value, onChange }: {
  cliente:  UserProfile | undefined
  empresa:  EmpresaTango
  value:    string
  onChange: (codigo: string) => void
}) {
  const lista = sucursalesDe(cliente, empresa)
  if (lista.length <= 1) return null
  return (
    <div>
      <label className="text-xs text-secundario mb-1 flex items-center gap-1">
        <MapPin size={12} /> Sucursal ({lista.length} códigos en Tango)
      </label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-white border rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent ${value ? 'border-[#D3D1C7]' : 'border-amber-400'}`}>
        <option value="">Elegí la sucursal…</option>
        {/* Una sucursal inhabilitada en Tango (2026-09-23) se ve pero no se elige. */}
        {lista.map((s) => <option key={s.codigo} value={s.codigo} disabled={!s.habilitada}>{etiquetaSucursal(s)}</option>)}
      </select>
      {!value && <p className="text-xs text-amber-600 mt-1">La venta se carga en Tango al código de la sucursal elegida.</p>}
      {value && lista.some((s) => s.codigo === value && !s.habilitada) && <p className="text-xs text-red-700 mt-1">Esa sucursal está inhabilitada en Tango: elegí otra.</p>}
    </div>
  )
}
