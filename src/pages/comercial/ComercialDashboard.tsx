import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Users, UserCheck, Tag, ArrowRight,
  Package, Truck, CheckCircle, Clock, History, BarChart2, CloudSun,
} from 'lucide-react'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '../../context/AuthContext'
import { useAllOrders } from '../../hooks/useOrders'
import { AvisoDatosTruncados } from '../../components/admin/AvisoDatosTruncados'
import { getClientesConHistoria, approveUser, updateUserStatus } from '../../services/userService'
import { useClientesIndexTodos } from '@/hooks/useClientesIndex'
import { reportError } from '@/services/observability'
import { Order, ClienteIndex, UserStatus } from '../../types'
import { ForecastStrip } from '@/components/common/ForecastStrip'
import { toDateStr, todayString, tsToDate } from '../../utils/helpers'
import type { Timestamp } from 'firebase/firestore'

// recharts (chunk `charts`) y el mapa de seguimiento (`maps`) bajan recién al
// montar el tablero, no con la ruta (auditoría de bundle 2026-09-14).
const MetricsDashboard = lazy(() => import('@/components/admin/MetricsDashboard'))
const TrackingMap      = lazy(() => import('@/components/comercial/TrackingMap'))

const INACTIVE_DAYS = 7

function isToday(order: Order) {
  if (!order.date) return false
  return toDateStr(tsToDate(order.date)) === todayString()
}

function daysSince(ts: Timestamp | null | undefined): number {
  if (!ts) return Infinity
  return Math.floor((Date.now() - tsToDate(ts).getTime()) / 86_400_000)
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ComercialDashboard() {
  const { user }   = useAuth()

  const { orders, loading: ordersLoading, truncado } = useAllOrders()
  // Índice liviano de clientes (2026-09-22): pendientes, activos y las
  // coordenadas del mapa salen de acá, sin bajar la ficha con precios.
  const { clientes: indice, loading: usersLoading } = useClientesIndexTodos()
  // "Sin lista" y "sin pedir hace N días" descartan a las cuentas de Tango que
  // nunca pidieron, y eso necesita aprobadoPor / fechaCreacion / ultimoPedidoAt,
  // que el índice todavía no trae: se piden solo los clientes con historia
  // (~970 de 2.226), no toda la cartera.
  const { data: conHistoria = [], isLoading: historiaLoading } = useQuery({
    queryKey: ['clientes', 'con-historia'],
    queryFn:  getClientesConHistoria,
    staleTime: 300_000,
  })
  // Estado cambiado en esta sesión (aprobar / rechazar): el índice lo refleja
  // cuando corre el trigger; hasta entonces se pisa a mano.
  const [estadoLocal, setEstadoLocal] = useState<Readonly<Record<string, UserStatus>>>({})

  const isLoading = ordersLoading || usersLoading || historiaLoading

  // ── Derived data ─────────────────────────────────────────────────────────

  const clientes   = useMemo(
    () => indice.map((c) => estadoLocal[c.uid] ? { ...c, estado: estadoLocal[c.uid] } : c),
    [indice, estadoLocal],
  )
  const pendientes = useMemo(() => clientes.filter((u) => u.estado === 'pendiente'), [clientes])
  // Las cuentas que la sync de Tango dio de alta y todavía no pidieron nunca
  // (padrón maestro, 2026-09-06) no cuentan como "sin lista" ni "inactivos":
  // son miles y taparían a los clientes reales de la cartera. Ya vienen
  // descartadas de getClientesConHistoria.
  // Sin lista = Tango no le asignó lista en Redonhielo (o no está vinculado a Tango).
  const sinLista   = useMemo(
    () => conHistoria.filter((u) => u.estado === 'activo' && !u.listaTango?.redonhielo && estadoLocal[u.uid] !== 'inactivo'),
    [conHistoria, estadoLocal],
  )

  // Clientes inactivos: usa users.ultimoPedidoAt (lo mantiene el trigger
  // onOrderRollup), así el dato es exacto y no depende del stream de 30 días que
  // se truncaba a escala (auditoría H5).
  const inactivos = useMemo(() => {
    return conHistoria.filter((u) => {
      if (u.estado !== 'activo' || estadoLocal[u.uid] === 'inactivo' || daysSince(u.fechaCreacion) <= INACTIVE_DAYS) return false
      if (!u.ultimoPedidoAt) return true
      return Math.floor((Date.now() / 1000 - u.ultimoPedidoAt.seconds) / 86400) >= INACTIVE_DAYS
    })
  }, [conHistoria, estadoLocal])

  const todayOrders = useMemo(() => orders.filter(isToday), [orders])

  const entregados  = useMemo(() => todayOrders.filter((o) => o.status === 'entregado').length,  [todayOrders])
  const enCamino    = useMemo(() => todayOrders.filter((o) => o.status === 'en_camino').length,   [todayOrders])
  const confirmados = useMemo(() => todayOrders.filter((o) => o.status === 'confirmado').length,  [todayOrders])
  const pendientesP = useMemo(() => todayOrders.filter((o) => o.status === 'pendiente').length,   [todayOrders])

  const patchEstado = (uid: string, estado: UserStatus) =>
    setEstadoLocal((prev) => ({ ...prev, [uid]: estado }))

  const handleAprobar = async (u: ClienteIndex) => {
    if (!user) return
    try {
      await approveUser(u.uid, user.uid)
      // El email de aprobación lo envía el trigger onUserApproved server-side.
      patchEstado(u.uid, 'activo')
    } catch (err) {
      reportError(err, { origen: 'ComercialDashboard', accion: 'aprobar cliente', uid: u.uid })
    }
  }

  const handleRechazar = async (u: ClienteIndex) => {
    if (!confirm(`¿Rechazar a ${u.razonSocial}? El cliente quedará inactivo.`)) return
    try {
      await updateUserStatus(u.uid, 'inactivo')
      patchEstado(u.uid, 'inactivo')
    } catch (err) {
      reportError(err, { origen: 'ComercialDashboard', accion: 'rechazar cliente', uid: u.uid })
    }
  }

  return (
    <div className="min-h-screen min-h-dvh bg-[#F1EFE8] text-gray-900">
      <main className="max-w-4xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold">Tablero</h1>
          <p className="text-secundario text-sm capitalize mt-0.5">
            {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        {isLoading ? <LoadingSpinner /> : (
          <>
            {/* ── Alertas comerciales ──────────────────────────────────── */}
            {(pendientes.length > 0 || sinLista.length > 0 || inactivos.length > 0) && (
              <section className="space-y-3">
                <h2 className="text-xs font-semibold text-secundario uppercase tracking-wide">
                  Requieren atención
                </h2>

                {/* Pendientes de aprobación */}
                {pendientes.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-semibold text-amber-700">
                      {pendientes.length} cliente{pendientes.length !== 1 ? 's' : ''} pendiente{pendientes.length !== 1 ? 's' : ''} de aprobación
                    </p>
                    {pendientes.map((u) => (
                      <div key={u.uid} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{u.razonSocial}</p>
                          <p className="text-xs text-secundario truncate">{u.email}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => { void handleRechazar(u) }}
                            className="text-xs py-1.5 px-3 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                          >
                            Rechazar
                          </button>
                          <Button onClick={() => { void handleAprobar(u) }} className="text-xs py-1.5 px-3">
                            Aprobar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sin lista de precios */}
                {sinLista.length > 0 && (
                  <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold flex items-center gap-2">
                        <Tag size={14} className="text-inerte" />
                        {sinLista.length} cliente{sinLista.length !== 1 ? 's' : ''} sin lista de precios
                      </p>
                      <Link to="/usuarios" className="text-xs text-accent hover:underline">
                        Asignar →
                      </Link>
                    </div>
                    <div className="space-y-1">
                      {sinLista.slice(0, 3).map((u) => (
                        <p key={u.uid} className="text-xs text-secundario truncate">
                          {u.razonSocial || u.nombre} — {u.email}
                        </p>
                      ))}
                      {sinLista.length > 3 && (
                        <p className="text-xs text-secundario">+{sinLista.length - 3} más</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Inactivos */}
                {inactivos.length > 0 && (
                  <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold flex items-center gap-2">
                        <Clock size={14} className="text-inerte" />
                        {inactivos.length} cliente{inactivos.length !== 1 ? 's' : ''} sin pedir hace {INACTIVE_DAYS}+ días
                      </p>
                      <Link to="/usuarios" className="text-xs text-accent hover:underline">
                        Ver →
                      </Link>
                    </div>
                    <div className="space-y-1">
                      {inactivos.slice(0, 3).map((u) => (
                        <p key={u.uid} className="text-xs text-secundario truncate">
                          {u.razonSocial || u.nombre}
                        </p>
                      ))}
                      {inactivos.length > 3 && (
                        <p className="text-xs text-secundario">+{inactivos.length - 3} más</p>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── Métricas del día ─────────────────────────────────────── */}
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-secundario uppercase tracking-wide">
                Pedidos de hoy — {todayOrders.length} en total
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard icon={<CheckCircle size={16} />} label="Entregados"  value={entregados}  color="text-green-600" border="border-green-500/20" />
                <StatCard icon={<Truck       size={16} />} label="En camino"   value={enCamino}    color="text-accent"    border="border-accent/20" />
                <StatCard icon={<Package     size={16} />} label="Confirmados" value={confirmados} color="text-blue-600"  border="border-blue-500/20" />
                <StatCard icon={<Clock       size={16} />} label="Pendientes"  value={pendientesP} color="text-amber-600" border="border-yellow-500/20" />
              </div>
            </section>

            {/* ── Ranking y métricas ───────────────────────────────────── */}
            {truncado && <AvisoDatosTruncados />}
            <Suspense fallback={<Skeleton className="h-[520px] rounded-xl" />}>
              <MetricsDashboard orders={orders} />
            </Suspense>

            {/* ── Pronóstico del tiempo ────────────────────────────────── */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-secundario uppercase tracking-wide">Clima — próximos 7 días</h2>
                <Link to="/admin/clima" className="text-xs text-accent hover:underline">Historial →</Link>
              </div>
              <ForecastStrip />
            </section>

            {/* ── Mapa de seguimiento ───────────────────────────────────── */}
            <Suspense fallback={<Skeleton className="h-12 rounded-xl" />}>
              <TrackingMap orders={todayOrders} clientes={clientes} />
            </Suspense>

            {/* ── Resumen de clientes ──────────────────────────────────── */}
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-secundario uppercase tracking-wide">Clientes</h2>
              <div className="grid grid-cols-3 gap-3">
                <StatCard icon={<Users size={16} />}     label="Activos"   value={clientes.filter(u => u.estado === 'activo').length}   color="text-accent"      border="border-[#D3D1C7]" />
                <StatCard icon={<UserCheck size={16} />} label="Pendientes" value={pendientes.length} color="text-amber-600" border={pendientes.length > 0 ? 'border-amber-300' : 'border-[#D3D1C7]'} />
                <StatCard icon={<Tag size={16} />}       label="Sin lista"  value={sinLista.length}   color="text-secundario"  border="border-[#D3D1C7]" />
              </div>
            </section>

            {/* ── Acceso rápido ────────────────────────────────────────── */}
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-secundario uppercase tracking-wide">Acciones</h2>
              <Link
                to="/comercial/pedidos"
                className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex items-center justify-between hover:border-accent transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <History size={18} className="text-accent" />
                  <div>
                    <p className="font-medium text-sm group-hover:text-accent transition-colors">Historial de pedidos</p>
                    <p className="text-secundario text-xs mt-0.5">Filtrá por cliente, día, mes o año</p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-inerte group-hover:text-accent transition-colors" />
              </Link>
              <Link
                to="/usuarios"
                className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex items-center justify-between hover:border-accent transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <Users size={18} className="text-accent" />
                  <div>
                    <p className="font-medium text-sm group-hover:text-accent transition-colors">Gestión de usuarios</p>
                    <p className="text-secundario text-xs mt-0.5">Aprobar clientes, asignar listas y precios especiales</p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-inerte group-hover:text-accent transition-colors" />
              </Link>
              <Link
                to="/comercial/ventas"
                className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex items-center justify-between hover:border-accent transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <BarChart2 size={18} className="text-accent" />
                  <div>
                    <p className="font-medium text-sm group-hover:text-accent transition-colors">Reporte de ventas</p>
                    <p className="text-secundario text-xs mt-0.5">Entregas, volumen por producto y ranking de clientes</p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-inerte group-hover:text-accent transition-colors" />
              </Link>
              <Link
                to="/admin/clima"
                className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex items-center justify-between hover:border-accent transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <CloudSun size={18} className="text-accent" />
                  <div>
                    <p className="font-medium text-sm group-hover:text-accent transition-colors">Historial de clima</p>
                    <p className="text-secundario text-xs mt-0.5">Temperatura e historial de ventas por día</p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-inerte group-hover:text-accent transition-colors" />
              </Link>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, color, border,
}: {
  icon:   React.ReactNode
  label:  string
  value:  number
  color:  string
  border: string
}) {
  return (
    <div className={`bg-white border ${border} rounded-xl p-4 space-y-2`}>
      {/* Un cero pierde el color del estado y queda en gris secundario: no
          es noticia, pero se sigue leyendo. Ver convenciones en CLAUDE.md. */}
      <div className={value === 0 ? 'text-secundario' : color}>{icon}</div>
      <p className={`text-2xl font-bold tabular-nums ${value === 0 ? 'text-secundario' : color}`}>{value.toLocaleString('es-AR')}</p>
      <p className="text-secundario text-xs">{label}</p>
    </div>
  )
}
