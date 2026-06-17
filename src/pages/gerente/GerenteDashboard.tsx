import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingUp, Users, Package, AlertCircle, CheckCircle,
  Clock, Map, Activity, ChevronRight, Truck,
} from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAllOrders } from '../../hooks/useOrders'
import { getAllUsers, updateUserDocument } from '../../services/userService'
import { UserProfile, Order } from '../../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function orderDateStr(o: Order): string {
  if (!o.date?.toDate) return ''
  return o.date.toDate().toISOString().split('T')[0]
}

function nDaysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

function clientLabel(u: UserProfile): string {
  return u.razonSocial || u.nombreContacto || u.nombre || u.email
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent, icon: Icon }: {
  label:  string
  value:  number
  sub?:   string
  accent: 'blue' | 'green' | 'cyan' | 'amber' | 'gray'
  icon:   React.ComponentType<{ size?: number; className?: string }>
}) {
  const colors = {
    blue:  { bg: 'bg-blue-50',    icon: 'text-blue-500',    val: 'text-blue-700'    },
    green: { bg: 'bg-emerald-50', icon: 'text-emerald-500', val: 'text-emerald-700' },
    cyan:  { bg: 'bg-cyan-50',    icon: 'text-cyan-500',    val: 'text-cyan-700'    },
    amber: { bg: 'bg-amber-50',   icon: 'text-amber-500',   val: 'text-amber-700'   },
    gray:  { bg: 'bg-gray-100',   icon: 'text-gray-400',    val: 'text-gray-600'    },
  }[accent]

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-4">
      <div className={`inline-flex p-2 rounded-lg ${colors.bg} mb-3`}>
        <Icon size={18} className={colors.icon} />
      </div>
      <p className={`text-2xl font-bold leading-none ${colors.val}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function GerenteDashboard() {
  const { orders, loading: loadO } = useAllOrders()
  const [allUsers, setAllUsers]   = useState<UserProfile[]>([])
  const [loadU, setLoadU]         = useState(true)
  const [approving, setApproving] = useState<string | null>(null)

  useEffect(() => {
    getAllUsers().then((u) => { setAllUsers(u); setLoadU(false) })
  }, [])

  const today    = todayStr()
  const clientes = useMemo(() => allUsers.filter((u) => u.rol === 'cliente'), [allUsers])

  // ── Stats del día ────────────────────────────────────────────────────────
  const ordersToday = useMemo(
    () => orders.filter((o) => orderDateStr(o) === today),
    [orders, today],
  )
  const activosHoy   = ordersToday.filter((o) => !['entregado', 'cancelado'].includes(o.status))
  const entregadosHoy = ordersToday.filter((o) => o.status === 'entregado').length
  const enCamino     = activosHoy.filter((o) => o.status === 'en_camino').length
  const sinAsignar   = activosHoy.filter((o) => !o.driverId).length

  // ── Barra semana ─────────────────────────────────────────────────────────
  const semana = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const str   = d.toISOString().split('T')[0]
      const label = i === 6 ? 'Hoy' : d.toLocaleDateString('es-AR', { weekday: 'short' })
      const count = orders.filter((o) => orderDateStr(o) === str && o.status !== 'cancelado').length
      return { str, label, count }
    })
  }, [orders])

  const maxSemana = Math.max(...semana.map((d) => d.count), 1)

  // ── Pendientes de aprobación ─────────────────────────────────────────────
  const pendientes = useMemo(
    () => clientes.filter((c) => c.estado === 'pendiente'),
    [clientes],
  )

  // ── Top clientes del mes ─────────────────────────────────────────────────
  const topMes = useMemo(() => {
    const inicioMes = new Date()
    inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0)
    const counts: Record<string, { nombre: string; qty: number }> = {}
    for (const o of orders) {
      if (!o.date?.toDate) continue
      if (o.date.toDate() < inicioMes || o.status === 'cancelado') continue
      if (!counts[o.clientId]) counts[o.clientId] = { nombre: o.clientName, qty: 0 }
      counts[o.clientId].qty += o.products.reduce((s, p) => s + p.quantity, 0)
    }
    return Object.entries(counts)
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 6)
  }, [orders])

  // ── Clientes fríos (activos sin pedir hace 30+ días) ────────────────────
  const frios = useMemo(() => {
    const cutoff = nDaysAgo(30)
    const ultimo: Record<string, Date> = {}
    for (const o of orders) {
      if (!o.date?.toDate || o.status === 'cancelado') continue
      const d = o.date.toDate()
      if (!ultimo[o.clientId] || d > ultimo[o.clientId]) ultimo[o.clientId] = d
    }
    return clientes
      .filter((c) => c.estado === 'activo' && (!ultimo[c.uid] || ultimo[c.uid] < cutoff))
      .slice(0, 8)
  }, [clientes, orders])

  const handleApprove = async (uid: string) => {
    setApproving(uid)
    try {
      await updateUserDocument(uid, { estado: 'activo' })
      setAllUsers((prev) => prev.map((u) => u.uid === uid ? { ...u, estado: 'activo' as const } : u))
    } finally {
      setApproving(null)
    }
  }

  if (loadO || loadU) return <><Navbar /><LoadingSpinner fullScreen /></>

  const fechaHoy = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-5xl mx-auto p-4 space-y-5 pb-12">

        {/* Header */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tablero de control</h1>
            <p className="text-gray-500 text-sm capitalize mt-0.5">{fechaHoy}</p>
          </div>
          {pendientes.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-full">
              <AlertCircle size={13} />
              {pendientes.length} cliente{pendientes.length !== 1 ? 's' : ''} esperando aprobación
            </span>
          )}
        </div>

        {/* Stats del día */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Pedidos hoy"
            value={activosHoy.length + entregadosHoy}
            sub={`${entregadosHoy} entregados`}
            accent="blue"
            icon={Package}
          />
          <StatCard label="En camino"   value={enCamino}   accent="cyan"  icon={Truck} />
          <StatCard
            label="Sin asignar"
            value={sinAsignar}
            accent={sinAsignar > 0 ? 'amber' : 'gray'}
            icon={AlertCircle}
          />
          <StatCard label="Clientes activos" value={clientes.filter(c => c.estado === 'activo').length} accent="green" icon={Users} />
        </div>

        {/* Semana */}
        <div className="bg-white border border-[#D3D1C7] rounded-xl p-4">
          <p className="text-sm font-semibold text-gray-900 mb-4">Pedidos — últimos 7 días</p>
          <div className="flex items-end gap-2" style={{ height: 88 }}>
            {semana.map((d) => {
              const h = d.count > 0 ? Math.max(Math.round((d.count / maxSemana) * 64), 8) : 3
              const isToday = d.str === today
              return (
                <div key={d.str} className="flex-1 flex flex-col items-center gap-1.5">
                  {d.count > 0 && (
                    <span className={`text-xs font-medium ${isToday ? 'text-accent' : 'text-gray-500'}`}>
                      {d.count}
                    </span>
                  )}
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t transition-all ${isToday ? 'bg-accent' : 'bg-accent/25'}`}
                      style={{ height: h }}
                    />
                  </div>
                  <span className={`text-[10px] capitalize ${isToday ? 'text-accent font-semibold' : 'text-gray-400'}`}>
                    {d.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Clientes pendientes */}
          {pendientes.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle size={15} className="text-amber-500 shrink-0" />
                <p className="text-sm font-semibold text-gray-900">Pendientes de aprobación</p>
                <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                  {pendientes.length}
                </span>
              </div>
              <div className="space-y-2.5">
                {pendientes.map((c) => (
                  <div key={c.uid} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate text-gray-900">{clientLabel(c)}</p>
                      <p className="text-xs text-gray-400 truncate">{c.email}</p>
                    </div>
                    <button
                      onClick={() => handleApprove(c.uid)}
                      disabled={approving === c.uid}
                      className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-success text-white font-medium hover:bg-success/90 transition-colors disabled:opacity-50"
                    >
                      {approving === c.uid ? '…' : 'Aprobar'}
                    </button>
                  </div>
                ))}
              </div>
              <Link to="/usuarios" className="block text-xs text-accent hover:underline">
                Ver todos los usuarios →
              </Link>
            </div>
          )}

          {/* Top clientes del mes */}
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-accent" />
              <p className="text-sm font-semibold text-gray-900">Top clientes del mes</p>
              <span className="ml-auto text-xs text-gray-400">unidades</span>
            </div>
            {topMes.length === 0 ? (
              <p className="text-xs text-gray-400 py-3 text-center">Sin pedidos este mes</p>
            ) : (
              <div className="space-y-2">
                {topMes.map(([uid, { nombre, qty }], i) => (
                  <div key={uid} className="flex items-center gap-3">
                    <span className="text-xs text-gray-300 w-4 text-right font-medium">{i + 1}</span>
                    <p className="flex-1 text-sm truncate text-gray-800">{nombre}</p>
                    <span className="text-xs font-semibold text-accent shrink-0">{qty.toLocaleString('es-AR')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Clientes fríos */}
          {frios.length > 0 && (
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-gray-400" />
                <p className="text-sm font-semibold text-gray-900">Sin pedido hace 30+ días</p>
                <span className="ml-auto text-xs text-gray-400">{frios.length}</span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {frios.map((c) => (
                  <p key={c.uid} className="text-sm text-gray-600 truncate">
                    · {clientLabel(c)}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Accesos rápidos */}
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-4">
            <p className="text-sm font-semibold text-gray-900 mb-3">Accesos rápidos</p>
            <div className="space-y-1">
              {[
                { to: '/admin/monitoreo',              label: 'GPS en tiempo real',     icon: Activity },
                { to: '/admin/mapa-clientes',          label: 'Mapa de clientes',       icon: Map },
                { to: '/comercial/ventas',             label: 'Reporte de ventas',      icon: TrendingUp },
                { to: '/comercial/historial-precios',  label: 'Historial de precios',   icon: Clock },
                { to: '/usuarios',                     label: 'Gestión de usuarios',    icon: Users },
              ].map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors group"
                >
                  <l.icon size={16} className="text-gray-400 group-hover:text-accent transition-colors shrink-0" />
                  <span className="text-sm text-gray-700 flex-1">{l.label}</span>
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-accent transition-colors" />
                </Link>
              ))}
            </div>
          </div>

        </div>

        {/* Completado hoy */}
        {entregadosHoy > 0 && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 flex items-center gap-3">
            <CheckCircle size={18} className="text-emerald-500 shrink-0" />
            <p className="text-sm text-emerald-700 font-medium">
              {entregadosHoy} pedido{entregadosHoy !== 1 ? 's' : ''} entregado{entregadosHoy !== 1 ? 's' : ''} hoy
            </p>
          </div>
        )}

      </main>
    </div>
  )
}
