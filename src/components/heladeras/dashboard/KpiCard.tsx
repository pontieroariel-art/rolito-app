import { Link } from 'react-router-dom'

// Variante liviana de KpiTile/StatTile pensada para navegar (no para
// togglear un filtro) — no se tocan esos dos componentes, tienen otro uso.
export default function KpiCard({
  to, value, label, subtitle, tone,
}: {
  to:        string
  value:     number
  label:     string
  subtitle?: string
  tone?:     'warn' | 'good'
}) {
  return (
    <Link
      to={to}
      className={`bg-white border rounded-xl p-3.5 flex flex-col gap-1 transition-colors hover:border-accent/50 ${
        tone === 'warn' ? 'border-t-4 border-t-amber-500 border-x-[#D3D1C7] border-b-[#D3D1C7]'
          : tone === 'good' ? 'border-t-4 border-t-accent border-x-[#D3D1C7] border-b-[#D3D1C7]'
          : 'border-[#D3D1C7]'
      }`}
    >
      <span className={`text-2xl font-bold tabular-nums ${
        tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-accent' : 'text-gray-900'
      }`}>
        {value}
      </span>
      <span className="text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
      {subtitle && <span className="text-[11px] text-amber-600 mt-0.5">{subtitle}</span>}
    </Link>
  )
}
