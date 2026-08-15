export default function KpiTile({
  value, label, active, tone, onClick,
}: {
  value:  number
  label:  string
  active: boolean
  tone?:  'warn' | 'good'
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white border rounded-xl p-3.5 flex flex-col gap-1 transition-colors ${
        active ? 'border-accent ring-1 ring-accent'
          : tone === 'warn' ? 'border-t-4 border-t-amber-500 border-x-[#D3D1C7] border-b-[#D3D1C7]'
          : tone === 'good' ? 'border-t-4 border-t-accent border-x-[#D3D1C7] border-b-[#D3D1C7]'
          : 'border-[#D3D1C7] hover:border-accent/50'
      }`}
    >
      <span className={`text-2xl font-bold tabular-nums ${
        tone === 'warn' ? 'text-amber-600' : tone === 'good' || active ? 'text-accent' : 'text-gray-900'
      }`}>{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
    </button>
  )
}
