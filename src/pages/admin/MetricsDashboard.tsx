import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  Package, Truck, CheckCircle2, Clock,
  XCircle, TrendingUp, Users, BarChart2,
  AlertTriangle, Weight, Trophy,
} from 'lucide-react'
import type { Order } from '../../types'

function toDateStr(ts: Order['date'] | null | undefined): string {
  if (!ts) return ''
  try { return ts.toDate().toISOString().split('T')[0] } catch { return '' }
}

function sumKg(orders: Order[]): number {
  return orders.reduce((acc, o) =>
    acc + o.products.reduce((s, p) => s + p.quantity, 0), 0)
}

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export default function MetricsDashboard({ orders }: { orders: Order[] }) {
  const now         = new Date()
  const today       = now.toISOString().split('T')[0]
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const todayOrders = useMemo(
    () => orders.filter((o) => toDateStr(o.date) === today),
    [orders, today],
  )

  const todayByStatus = useMemo(() => ({
    pendiente:  todayOrders.filter((o) => o.status === 'pendiente').length,
    confirmado: todayOrders.filter((o) => o.status === 'confirmado').length,
    en_camino:  todayOrders.filter((o) => o.status === 'en_camino').length,
    entregado:  todayOrders.filter((o) => o.status === 'entregado').length,
    cancelado:  todayOrders.filter((o) => o.status === 'cancelado').length,
  }), [todayOrders])

  const todayKg = useMemo(
    () => sumKg(todayOrders.filter((o) => o.status === 'entregado')),
    [todayOrders],
  )

  const monthOrders = useMemo(
    () => orders.filter((o) => toDateStr(o.date).startsWith(monthPrefix)),
    [orders, monthPrefix],
  )

  const monthKg             = useMemo(() => sumKg(monthOrders), [monthOrders])
  const monthActiveClients  = useMemo(
    () => new Set(monthOrders.map((o) => o.clientId)).size,
    [monthOrders],
  )
  const avgKgPerOrder = monthOrders.length > 0
    ? Math.round(monthKg / monthOrders.length)
    : 0

  const weeklyData = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now)
      d.setDate(d.getDate() - (6 - i))
      const dateStr = d.toISOString().split('T')[0]
      return {
        day:   DAY_LABELS[d.getDay()],
        count: orders.filter((o) => toDateStr(o.date) === dateStr).length,
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders],
  )

  const topClients = useMemo(() => {
    const map = new Map<string, { name: string; count: number; kg: number }>()
    monthOrders.forEach((o) => {
      const prev = map.get(o.clientId) ?? { name: o.clientName, count: 0, kg: 0 }
      prev.count += 1
      prev.kg    += o.products.reduce((s, p) => s + p.quantity, 0)
      map.set(o.clientId, prev)
    })
    return [...map.entries()]
      .map(([id, v]) => ({ clientId: id, ...v }))
      .sort((a, b) => b.kg - a.kg)
      .slice(0, 5)
  }, [monthOrders])

  const inactiveClients = useMemo(() => {
    const sevenDaysAgo = new Date(now)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const lastOrder = new Map<string, { name: string; date: Date }>()
    orders.forEach((o) => {
      let d: Date
      try { d = o.date.toDate() } catch { return }
      const prev = lastOrder.get(o.clientId)
      if (!prev || d > prev.date) lastOrder.set(o.clientId, { name: o.clientName, date: d })
    })

    return [...lastOrder.entries()]
      .filter(([, v]) => v.date < sevenDaysAgo)
      .map(([id, v]) => ({
        clientId:  id,
        name:      v.name,
        lastDate:  v.date,
        daysSince: Math.floor((now.getTime() - v.date.getTime()) / 86_400_000),
      }))
      .sort((a, b) => b.daysSince - a.daysSince)
      .slice(0, 10)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders])

  return (
    <section className="space-y-5">

      <div>
        <SectionTitle icon={<Clock size={15} />} title="Hoy" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard label="Total pedidos"   value={todayOrders.length}        color="text-gray-900"          icon={<Package      size={14} />} />
          <MetricCard label="Pendientes"      value={todayByStatus.pendiente}   color="text-[#BA7517]"         icon={<Clock        size={14} />} />
          <MetricCard label="Confirmados"     value={todayByStatus.confirmado}  color="text-[#185FA5]"         icon={<CheckCircle2 size={14} />} />
          <MetricCard label="En camino"       value={todayByStatus.en_camino}   color="text-[#0F6E56]"         icon={<Truck        size={14} />} />
          <MetricCard label="Entregados"      value={todayByStatus.entregado}   color="text-[#085041]"         icon={<CheckCircle2 size={14} />} />
          <MetricCard label="Cancelados"      value={todayByStatus.cancelado}   color="text-[#A32D2D]"         icon={<XCircle      size={14} />} />
        </div>
        {todayKg > 0 && (
          <div className="mt-3 bg-[#E8F5F0] border border-[#B3DDD3] rounded-xl px-4 py-3 flex items-center gap-3">
            <Weight size={16} className="text-accent shrink-0" />
            <p className="text-sm text-gray-900">
              <span className="text-accent font-bold text-lg">{todayKg.toLocaleString('es-AR')}</span>
              <span className="text-gray-500 ml-1.5">kg entregados hoy</span>
            </p>
          </div>
        )}
      </div>

      <div>
        <SectionTitle icon={<BarChart2 size={15} />} title={`Mes actual — ${now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Pedidos del mes"     value={monthOrders.length} color="text-gray-900"  icon={<Package    size={14} />} />
          <MetricCard label="Kg del mes"          value={monthKg}            color="text-accent"    icon={<Weight     size={14} />} suffix="kg" />
          <MetricCard label="Clientes activos"    value={monthActiveClients} color="text-accent"    icon={<Users      size={14} />} />
          <MetricCard label="Promedio / pedido"   value={avgKgPerOrder}      color="text-accent"    icon={<TrendingUp size={14} />} suffix="kg" />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">

        <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 min-w-0 overflow-hidden">
          <p className="text-sm font-medium mb-4 flex items-center gap-2 text-gray-900">
            <TrendingUp size={14} className="text-accent" />
            Tendencia — últimos 7 días
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weeklyData} margin={{ top: 4, right: 20, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fill: '#9CA3AF', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#9CA3AF', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: '#ffffff',
                  border: '1px solid #E5E7EB',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: '#6B7280' }}
                itemStyle={{ color: '#1D9E75' }}
                cursor={{ fill: 'rgba(29,158,117,0.06)' }}
              />
              <Bar dataKey="count" name="Pedidos" fill="#1D9E75" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 min-w-0 overflow-hidden">
          <p className="text-sm font-medium mb-4 flex items-center gap-2 text-gray-900">
            <Trophy size={14} className="text-accent" />
            Top clientes del mes
          </p>
          {topClients.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-10">Sin pedidos este mes</p>
          ) : (
            <div className="space-y-3">
              {topClients.map((c, i) => (
                <div key={c.clientId} className="flex items-center gap-3">
                  <span className={`w-5 text-xs font-bold shrink-0 text-center ${
                    i === 0 ? 'text-amber-500' :
                    i === 1 ? 'text-gray-400'  :
                    i === 2 ? 'text-amber-600'  : 'text-gray-400'
                  }`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate leading-tight">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.count} pedido{c.count !== 1 ? 's' : ''}</p>
                  </div>
                  <span className="text-accent font-bold text-sm shrink-0">
                    {c.kg.toLocaleString('es-AR')} kg
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {inactiveClients.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-medium mb-3 flex items-center gap-2 text-gray-900">
            <AlertTriangle size={14} className="text-amber-500" />
            <span className="text-amber-600">Sin pedir hace más de 7 días</span>
            <span className="ml-auto text-xs text-gray-400 font-normal">
              {inactiveClients.length} cliente{inactiveClients.length !== 1 ? 's' : ''}
            </span>
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {inactiveClients.map((c) => (
              <div
                key={c.clientId}
                className="flex justify-between items-center py-1.5 border-b border-gray-100 last:border-0 gap-3"
              >
                <p className="text-sm text-gray-900 truncate flex-1">{c.name}</p>
                <p className="text-xs text-gray-400 shrink-0">
                  {c.lastDate.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                  <span className="ml-1.5 text-amber-600 font-medium">
                    {c.daysSince}d
                  </span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <p className="text-sm font-medium mb-3 flex items-center gap-2 text-gray-900">
      <span className="text-accent">{icon}</span>
      {title}
    </p>
  )
}

function MetricCard({
  label, value, icon, color, suffix = '',
}: {
  label:   string
  value:   number
  icon:    React.ReactNode
  color:   string
  suffix?: string
}) {
  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={color}>{icon}</span>
        <p className="text-xs text-gray-500 truncate">{label}</p>
      </div>
      <p className={`text-2xl font-bold ${color}`}>
        {value.toLocaleString('es-AR')}
        {suffix && <span className="text-xs font-normal ml-1 text-gray-400">{suffix}</span>}
      </p>
    </div>
  )
}
