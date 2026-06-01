import { useState, useEffect, useMemo, ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAllOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { useNotificationEmails } from '../../hooks/useNotificationEmails'
import { useAuth } from '../../context/AuthContext'
import { cleanupTestData, CleanupResult } from '../../services/cleanupService'
import { generateRecurrentesForToday } from '../../services/recurrenteService'
import MetricsDashboard from './MetricsDashboard'
import { ForecastStrip } from './ClimaPage'
import ImportarPedidoModal from '../../components/admin/ImportarPedidoModal'
import { LiveMapSection }           from '../../components/admin/LiveMapSection'
import { ResumenCargaPorChofer }    from '../../components/admin/ResumenCargaPorChofer'
import { AdminOrderCard }           from '../../components/admin/AdminOrderCard'
import { NotificationEmailManager } from '../../components/admin/NotificationEmailManager'
import { ALL_STATUSES, STATUS_LABELS } from '../../utils/constants'
import { generateHojaDeRuta } from '../../utils/pdf'
import { Order, OrderStatus } from '../../types'

export default function AdminDashboard() {
  const { orders, loading } = useAllOrders()
  const { user }            = useAuth()
  const choferes            = useChoferes()
  const notifEmails         = useNotificationEmails()
  const [search,     setSearch]     = useState('')
  const [filter,     setFilter]     = useState<OrderStatus | 'all'>('all')
  const [dateFilter, setDateFilter] = useState('')
  const [cleanupModal,  setCleanupModal]  = useState(false)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupResult,  setCleanupResult]  = useState<CleanupResult | null>(null)
  const [pdfDriver,  setPdfDriver]  = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [importModal, setImportModal] = useState(false)
  const [recurrentesBanner, setRecurrentesBanner] = useState<number | null>(null)

  const isSuperAdmin = user?.rol === 'super_admin'

  useEffect(() => {
    generateRecurrentesForToday()
      .then((n) => { if (n > 0) setRecurrentesBanner(n) })
      .catch(console.error)
  }, [])

  const handleCleanup = async () => {
    if (!user?.uid) return
    setCleanupLoading(true)
    try {
      const result = await cleanupTestData(user.uid)
      setCleanupResult(result)
    } finally {
      setCleanupLoading(false)
    }
  }

  const hoy = new Date().toLocaleDateString('es-AR')
  const choferesSinCamionHoy = choferes.choferes.filter((c) => {
    const tieneOrden = orders.some(
      (o) => o.driverId === c.email && !['entregado', 'cancelado'].includes(o.status),
    )
    if (!tieneOrden) return false
    if (!c.camionId) return true
    if (!c.camionFechaAsignacion?.toDate) return true
    return c.camionFechaAsignacion.toDate().toLocaleDateString('es-AR') !== hoy
  })

  const filtered = useMemo(() => orders.filter((o) => {
    const matchStatus = filter === 'all' || o.status === filter
    const matchDate   = !dateFilter || o.date?.toDate?.().toISOString().split('T')[0] === dateFilter
    const q = search.toLowerCase()
    const matchSearch = !q ||
      o.clientName?.toLowerCase().includes(q) ||
      o.clientAddress?.toLowerCase().includes(q) ||
      o.products?.some((p) => p.name.toLowerCase().includes(q))
    return matchStatus && matchDate && matchSearch
  }), [orders, filter, dateFilter, search])

  if (loading) return <div className="min-h-screen bg-[#F1EFE8]"><Navbar /><LoadingSpinner fullScreen /></div>

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-5xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Panel Admin</h1>
            <p className="text-gray-500 text-sm">Gestión de pedidos y logística</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setImportModal(true)} className="text-sm">+ Importar PDF</Button>
            <NotificationEmailManager notifEmails={notifEmails} />
          </div>
        </div>

        {recurrentesBanner !== null && (
          <div className="bg-[#E8F5F0] border border-[#B3DDD3] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-accent text-sm">
              ↺ {recurrentesBanner} pedido{recurrentesBanner > 1 ? 's' : ''} recurrente{recurrentesBanner > 1 ? 's' : ''} generado{recurrentesBanner > 1 ? 's' : ''} automáticamente para hoy
            </p>
            <button onClick={() => setRecurrentesBanner(null)} className="text-gray-400 hover:text-gray-700 text-xs">✕</button>
          </div>
        )}

        {choferesSinCamionHoy.length > 0 && (
          <Link
            to="/admin/flota"
            className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 hover:bg-amber-100 transition-colors"
          >
            <span className="text-amber-500 text-xl shrink-0">🚛</span>
            <div className="flex-1">
              <p className="text-amber-700 font-medium text-sm">
                {choferesSinCamionHoy.length} chofer{choferesSinCamionHoy.length !== 1 ? 'es' : ''} sin camión confirmado para hoy
              </p>
              <p className="text-amber-600/70 text-xs mt-0.5">
                {choferesSinCamionHoy.map((c) => c.nombreContacto || c.nombre).join(', ')} · Tocá para asignar →
              </p>
            </div>
          </Link>
        )}

        {isSuperAdmin && (
          <>
            <button
              onClick={() => { setCleanupResult(null); setCleanupModal(true) }}
              className="w-full text-left bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 hover:bg-red-100 transition-colors"
            >
              Limpiar datos de prueba →
            </button>

            <Modal
              open={cleanupModal}
              onClose={() => { if (!cleanupLoading) setCleanupModal(false) }}
              title="Limpiar datos de prueba"
            >
              {cleanupResult ? (
                <div className="space-y-4">
                  <div className="bg-[#E8F5F0] border border-[#B3DDD3] rounded-xl p-4 space-y-1 text-sm">
                    <p className="font-medium text-accent mb-2">Limpieza completada</p>
                    <p className="text-gray-500">Usuarios eliminados: <span className="text-gray-900 font-medium">{cleanupResult.users}</span></p>
                    <p className="text-gray-500">Pedidos eliminados: <span className="text-gray-900 font-medium">{cleanupResult.orders}</span></p>
                    <p className="text-gray-500">Ubicaciones eliminadas: <span className="text-gray-900 font-medium">{cleanupResult.ubicaciones}</span></p>
                    {cleanupResult.clientes > 0 && (
                      <p className="text-gray-500">Clientes eliminados: <span className="text-gray-900 font-medium">{cleanupResult.clientes}</span></p>
                    )}
                  </div>
                  <Button className="w-full" onClick={() => setCleanupModal(false)}>Cerrar</Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm space-y-2">
                    <p className="text-red-600 font-medium">Esta acción no se puede deshacer.</p>
                    <p className="text-gray-500">Se borrarán todos los usuarios de prueba (excepto tu cuenta), todos los pedidos, y todas las ubicaciones.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setCleanupModal(false)} className="flex-1" disabled={cleanupLoading}>Cancelar</Button>
                    <Button variant="danger" onClick={handleCleanup} loading={cleanupLoading} className="flex-1">Sí, limpiar todo</Button>
                  </div>
                </div>
              )}
            </Modal>
          </>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Clima — próximos 7 días</h2>
            <Link to="/admin/clima" className="text-xs text-accent hover:underline">Historial →</Link>
          </div>
          <ForecastStrip />
        </section>

        <MetricsDashboard orders={orders} />
        <LiveMapSection orders={orders} />
        <ResumenCargaPorChofer orders={orders} choferes={choferes.choferes} />

        <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700 shrink-0">📄 Hoja de ruta</span>
          <select
            value={pdfDriver}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setPdfDriver(e.target.value)}
            aria-label="Seleccionar chofer para hoja de ruta"
            className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent flex-1 min-w-40"
          >
            <option value="">— Seleccionar chofer —</option>
            {choferes.choferes.map((c) => (
              <option key={c.uid} value={c.email ?? ''}>{c.nombreContacto || c.nombre || c.email}</option>
            ))}
          </select>
          <Button
            variant="outline"
            disabled={!pdfDriver || pdfLoading}
            loading={pdfLoading}
            className="text-sm shrink-0"
            onClick={async () => {
              setPdfLoading(true)
              const driverOrders = orders.filter((o) => o.driverId === pdfDriver && !['entregado', 'cancelado'].includes(o.status))
              const chofer = choferes.choferes.find((c) => c.email === pdfDriver)
              const name   = chofer?.nombreContacto || chofer?.nombre || pdfDriver
              await generateHojaDeRuta(driverOrders, name)
              setPdfLoading(false)
            }}
          >
            Exportar PDF
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <input
              value={search}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, dirección o producto..."
              aria-label="Buscar pedidos"
              className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="date"
              value={dateFilter}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDateFilter(e.target.value)}
              aria-label="Filtrar por fecha"
              className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {(search || dateFilter) && (
              <button
                onClick={() => { setSearch(''); setDateFilter('') }}
                className="text-sm text-gray-400 hover:text-gray-700 px-3 py-2"
              >
                Limpiar ✕
              </button>
            )}
          </div>

          <div className="flex gap-2 flex-wrap" role="group" aria-label="Filtrar por estado">
            {(['all', ...ALL_STATUSES] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                aria-pressed={filter === s}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  filter === s
                    ? 'bg-accent text-white border-accent'
                    : 'border-[#D3D1C7] text-gray-500 hover:border-accent/50 hover:text-gray-900'
                }`}
              >
                {s === 'all' ? `Todos (${orders.length})` : `${STATUS_LABELS[s]} (${orders.filter((o: Order) => o.status === s).length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center">
              <p className="text-gray-400 text-sm">No hay pedidos con estos filtros</p>
            </div>
          ) : (
            filtered.map((o: Order) => (
              <AdminOrderCard key={o.id} order={o} choferes={choferes.choferes} />
            ))
          )}
        </div>
      </main>

      <ImportarPedidoModal open={importModal} onClose={() => setImportModal(false)} />
    </div>
  )
}
