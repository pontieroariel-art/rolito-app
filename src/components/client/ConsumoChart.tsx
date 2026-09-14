import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

export interface MesConsumo { label: string; unidades: number }

// Barras de "Mi consumo — últimos 6 meses" del historial del cliente. Es lo
// único de esa pantalla que usa recharts, así que vive aparte y OrderHistory
// lo carga con React.lazy: el chunk `charts` (108 KB gz) baja recién cuando
// hay consumo para dibujar (auditoría de bundle 2026-09-14).
export default function ConsumoChart({ meses }: { meses: MesConsumo[] }) {
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={meses} margin={{ top: 4, right: 30, left: -30, bottom: 0 }}>
        <XAxis
          dataKey="label"
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
          formatter={(v: any) => [`${v} u.`, 'Unidades']}
          cursor={{ fill: '#f3f4f6' }}
        />
        <Bar dataKey="unidades" radius={[4, 4, 0, 0]} maxBarSize={32}>
          {meses.map((m, i) => (
            <Cell
              key={i}
              fill={i === meses.length - 1 ? '#1D9E75' : '#D1FAE5'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
