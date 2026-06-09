import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { GoogleMap, Marker, InfoWindow } from '@react-google-maps/api'
import {
  Users, UserCheck, Tag, ArrowRight,
  Package, Truck, CheckCircle, Clock, MapPin, History, BarChart2, CloudSun,
} from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAuth } from '../../context/AuthContext'
import { useAllOrders } from '../../hooks/useOrders'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { getAllUsers, approveUser, updateUserStatus } from '../../services/userService'
import { subscribeAllActiveDrivers, ActiveDriver } from '../../services/locationService'
import { useNotifyAprobado } from '../../hooks/useNotifications'
import { Order, UserProfile } from '../../types'
import MetricsDashboard from '../admin/MetricsDashboard'
import { ForecastStrip } from '../admin/ClimaPage'

const MAP_CONTAINER: React.CSSProperties = { width: '100%', height: '100%' }
const BA_DEFAULT = { lat: -34.6037, lng: -58.3816 }
const INACTIVE_DAYS = 7

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry',           stylers: [{ color: '#0A1628' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#8eabd4' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A1628' }] },
  { featureType: 'road',               elementType: 'geometry', stylers: [{ color: '#1a2f4a' }] },
  { featureType: 'water',              elementType: 'geometry', stylers: [{ color: '#061020' }] },
  { featureType: 'poi',                stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',            stylers: [{ visibility: 'off' }] },
]

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function isToday(order: Order) {
  if (!order.date) return false
  const d = order.date.toDate ? order.date.toDate() : new Date((order.date as any).seconds * 1000)
  return d.toISOString().split('T')[0] === todayStr()
}

function daysSince(ts: any): number {
  if (!ts) return Infinity
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ComercialDashboard() {
  const { user }   = useAuth()
  const qc         = useQueryClient()
  const notifyAprobado = useNotifyAprobado()

  const { orders, loading: ordersLoading } = useAllOrders()
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn:  getAllUsers,
    staleTime: 300_000,
  })

  const isLoading = ordersLoading || usersLoading

  // ── Derived data ─────────────────────────────────────────────────────────

  const clientes   = useMemo(() => users.filter((u) => u.rol === 'cliente'), [users])
  const pendientes = useMemo(() => clientes.filter((u) => u.estado === 'pendiente'), [clientes])
  const sinLista   = useMemo(() => clientes.filter((u) => u.estado === 'activo' && !u.listaPreciosId), [clientes])

  const inactivos = useMemo(() => {
    const lastOrderByClient = new Map<string, number>()
    for (const o of orders) {
      const prev = lastOrderByClient.get(o.clientId) ?? 0
      const cur  = o.createdAt?.seconds ?? 0
      if (cur > prev) lastOrderByClient.set(o.clientId, cur)
    }
    return clientes.filter((u) => {
      if (u.estado !== 'activo' || daysSince(u.fechaCreacion) <= INACTIVE_DAYS) return false
      const lastSec = lastOrderByClient.get(u.uid)
      if (!lastSec) return true
      return Math.floor((Date.now() / 1000 - lastSec) / 86400) >= INACTIVE_DAYS
    })
  }, [clientes, orders])

  const todayOrders = useMemo(() => orders.filter(isToday), [orders])

  const entregados  = useMemo(() => todayOrders.filter((o) => o.status === 'entregado').length,  [todayOrders])
  const enCamino    = useMemo(() => todayOrders.filter((o) => o.status === 'en_camino').length,   [todayOrders])
  const confirmados = useMemo(() => todayOrders.filter((o) => o.status === 'confirmado').length,  [todayOrders])
  const pendientesP = useMemo(() => todayOrders.filter((o) => o.status === 'pendiente').length,   [todayOrders])
  const cancelados  = useMemo(() => todayOrders.filter((o) => o.status === 'cancelado').length,   [todayOrders])

  const patchUser = (uid: string, patch: Partial<UserProfile>) =>
    qc.setQueryData<UserProfile[]>(['users'], (prev) =>
      prev?.map((p) => p.uid === uid ? { ...p, ...patch } : p) ?? []
    )

  const handleAprobar = async (u: UserProfile) => {
    if (!user) return
    await approveUser(u.uid, user.uid)
    notifyAprobado.mutate({ email: u.email, nombre: u.razonSocial || u.nombreContacto || u.nombre || '' })
    patchUser(u.uid, { estado: 'activo' })
  }

  const handleRechazar = async (u: UserProfile) => {
    if (!confirm(`¿Rechazar a ${u.razonSocial || u.nombre}? El cliente quedará inactivo.`)) return
    await updateUserStatus(u.uid, 'inactivo')
    patchUser(u.uid, { estado: 'inactivo' })
  }

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-4xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold">Tablero</h1>
          <p className="text-gray-500 text-sm capitalize mt-0.5">
            {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        {isLoading ? <LoadingSpinner /> : (
          <>
            {/* ── Alertas comerciales ──────────────────────────────────── */}
            {(pendientes.length > 0 || sinLista.length > 0 || inactivos.length > 0) && (
              <section className="space-y-3">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
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
                          <p className="text-sm font-medium truncate">{u.razonSocial || u.nombre}</p>
                          <p className="text-xs text-gray-500 truncate">{u.email}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleRechazar(u)}
                            className="text-xs py-1.5 px-3 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                          >
                            Rechazar
                          </button>
                          <Button onClick={() => handleAprobar(u)} className="text-xs py-1.5 px-3">
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
                        <Tag size={14} className="text-gray-400" />
                        {sinLista.length} cliente{sinLista.length !== 1 ? 's' : ''} sin lista de precios
                      </p>
                      <Link to="/usuarios" className="text-xs text-accent hover:underline">
                        Asignar →
                      </Link>
                    </div>
                    <div className="space-y-1">
                      {sinLista.slice(0, 3).map((u) => (
                        <p key={u.uid} className="text-xs text-gray-500 truncate">
                          {u.razonSocial || u.nombre} — {u.email}
                        </p>
                      ))}
                      {sinLista.length > 3 && (
                        <p className="text-xs text-gray-500">+{sinLista.length - 3} más</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Inactivos */}
                {inactivos.length > 0 && (
                  <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold flex items-center gap-2">
                        <Clock size={14} className="text-gray-400" />
                        {inactivos.length} cliente{inactivos.length !== 1 ? 's' : ''} sin pedir hace {INACTIVE_DAYS}+ días
                      </p>
                      <Link to="/usuarios" className="text-xs text-accent hover:underline">
                        Ver →
                      </Link>
                    </div>
                    <div className="space-y-1">
                      {inactivos.slice(0, 3).map((u) => (
                        <p key={u.uid} className="text-xs text-gray-500 truncate">
                          {u.razonSocial || u.nombre}
                        </p>
                      ))}
                      {inactivos.length > 3 && (
                        <p className="text-xs text-gray-500">+{inactivos.length - 3} más</p>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── Métricas del día ─────────────────────────────────────── */}
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
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
            <MetricsDashboard orders={orders} />

            {/* ── Pronóstico del tiempo ────────────────────────────────── */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Clima — próximos 7 días</h2>
                <Link to="/admin/clima" className="text-xs text-accent hover:underline">Historial →</Link>
              </div>
              <ForecastStrip />
            </section>

            {/* ── Mapa de seguimiento ───────────────────────────────────── */}
            <TrackingMap orders={todayOrders} />

            {/* ── Resumen de clientes ──────────────────────────────────── */}
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Clientes</h2>
              <div className="grid grid-cols-3 gap-3">
                <StatCard icon={<Users size={16} />}     label="Activos"   value={clientes.filter(u => u.estado === 'activo').length}   color="text-accent"      border="border-[#D3D1C7]" />
                <StatCard icon={<UserCheck size={16} />} label="Pendientes" value={pendientes.length} color="text-amber-600" border={pendientes.length > 0 ? 'border-amber-300' : 'border-[#D3D1C7]'} />
                <StatCard icon={<Tag size={16} />}       label="Sin lista"  value={sinLista.length}   color="text-gray-500"  border="border-[#D3D1C7]" />
              </div>
            </section>

            {/* ── Acceso rápido ────────────────────────────────────────── */}
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Acciones</h2>
              <Link
                to="/comercial/pedidos"
                className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex items-center justify-between hover:border-accent transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <History size={18} className="text-accent" />
                  <div>
                    <p className="font-medium text-sm group-hover:text-accent transition-colors">Historial de pedidos</p>
                    <p className="text-gray-500 text-xs mt-0.5">Filtrá por cliente, día, mes o año</p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-gray-400 group-hover:text-accent transition-colors" />
              </Link>
              <Link
                to="/usuarios"
                className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex items-center justify-between hover:border-accent transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <Users size={18} className="text-accent" />
                  <div>
                    <p className="font-medium text-sm group-hover:text-accent transition-colors">Gestión de usuarios</p>
                    <p className="text-gray-500 text-xs mt-0.5">Aprobar clientes, asignar listas y precios especiales</p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-gray-400 group-hover:text-accent transition-colors" />
              </Link>
              <Link
                to="/comercial/ventas"
                className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex items-center justify-between hover:border-accent transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <BarChart2 size={18} className="text-accent" />
                  <div>
                    <p className="font-medium text-sm group-hover:text-accent transition-colors">Reporte de ventas</p>
                    <p className="text-gray-500 text-xs mt-0.5">Entregas, volumen por producto y ranking de clientes</p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-gray-400 group-hover:text-accent transition-colors" />
              </Link>
              <Link
                to="/admin/clima"
                className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex items-center justify-between hover:border-accent transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <CloudSun size={18} className="text-accent" />
                  <div>
                    <p className="font-medium text-sm group-hover:text-accent transition-colors">Historial de clima</p>
                    <p className="text-gray-500 text-xs mt-0.5">Temperatura e historial de ventas por día</p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-gray-400 group-hover:text-accent transition-colors" />
              </Link>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

// ── TrackingMap ───────────────────────────────────────────────────────────────

function TrackingMap({ orders }: { orders: Order[] }) {
  const { isLoaded }                  = useGoogleMapsLoader()
  const [open, setOpen]               = useState(false)
  const [drivers, setDrivers]         = useState<ActiveDriver[]>([])
  const [selected, setSelected]       = useState<string | null>(null)
  const mapRef                        = useRef<google.maps.Map | null>(null)

  useEffect(() => {
    if (!open) return
    return subscribeAllActiveDrivers(setDrivers)
  }, [open])

  const activeOrders = orders.filter((o) => !['entregado', 'cancelado'].includes(o.status))

  return (
    <section className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full bg-white border border-[#D3D1C7] rounded-xl px-4 py-3 flex items-center justify-between hover:border-accent transition-colors text-sm"
      >
        <div className="flex items-center gap-2 font-medium">
          <MapPin size={15} className="text-accent" />
          Mapa de seguimiento
          {drivers.length > 0 && (
            <span className="text-xs text-accent">· {drivers.length} chofer{drivers.length !== 1 ? 'es' : ''} activo{drivers.length !== 1 ? 's' : ''}</span>
          )}
          {activeOrders.length > 0 && (
            <span className="text-xs text-gray-500">· {activeOrders.length} pedido{activeOrders.length !== 1 ? 's' : ''} en curso</span>
          )}
        </div>
        <span className="text-gray-500 text-xs">{open ? '▲ Cerrar' : '▼ Ver mapa'}</span>
      </button>

      {open && (
        <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden" style={{ height: 380 }}>
          {!isLoaded ? (
            <div className="h-full flex items-center justify-center">
              <LoadingSpinner />
            </div>
          ) : (
            <GoogleMap
              mapContainerStyle={MAP_CONTAINER}
              center={BA_DEFAULT}
              zoom={12}
              options={{ styles: DARK_MAP_STYLES, disableDefaultUI: true, zoomControl: true }}
              onLoad={(m) => { mapRef.current = m }}
            >
              {/* Choferes activos */}
              {drivers.map((d) => (
                <Marker
                  key={d.email}
                  position={{ lat: d.lat, lng: d.lng }}
                  icon={{ url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png' }}
                  onClick={() => setSelected((s) => s === d.email ? null : d.email)}
                >
                  {selected === d.email && (
                    <InfoWindow onCloseClick={() => setSelected(null)}>
                      <div style={{ color: '#111', fontSize: 13 }}>
                        <p style={{ fontWeight: 700, margin: '0 0 2px' }}>{d.nombreChofer || d.email}</p>
                        {d.telefonoChofer && <p style={{ margin: 0 }}>📞 {d.telefonoChofer}</p>}
                      </div>
                    </InfoWindow>
                  )}
                </Marker>
              ))}

              {/* Pedidos activos con lat/lng */}
              {activeOrders
                .filter((o) => {
                  const addr = o.clientAddress
                  return addr && addr.includes(',')
                })
                .map((o) => (
                  <Marker
                    key={o.id}
                    position={BA_DEFAULT}
                    icon={{ url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png' }}
                  />
                ))
              }
            </GoogleMap>
          )}
        </div>
      )}
    </section>
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
      <div className={color}>{icon}</div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-gray-500 text-xs">{label}</p>
    </div>
  )
}
