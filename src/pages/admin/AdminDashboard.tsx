import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { Skeleton } from '../../components/ui/skeleton'
import { useAllOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { useNotificationEmails } from '../../hooks/useNotificationEmails'
import { useAuth } from '../../context/AuthContext'
import { cleanupTestData, CleanupResult } from '../../services/cleanupService'
import { generateRecurrentesForToday } from '../../services/recurrenteService'
import MetricsDashboard from './MetricsDashboard'
import { ForecastStrip } from './ClimaPage'
import { LiveMapSection }           from '../../components/admin/LiveMapSection'
import { ResumenCargaPorChofer }    from '../../components/admin/ResumenCargaPorChofer'
import { NotificationEmailManager } from '../../components/admin/NotificationEmailManager'

export default function AdminDashboard() {
  const { orders, loading } = useAllOrders()
  const { user }            = useAuth()
  const choferes            = useChoferes()
  const notifEmails         = useNotificationEmails()
  const [cleanupModal,   setCleanupModal]   = useState(false)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupResult,  setCleanupResult]  = useState<CleanupResult | null>(null)
  const [recurrentesBanner, setRecurrentesBanner] = useState<number | null>(null)

  const isSuperAdmin = user?.rol === 'super_admin'

  useEffect(() => {
    const key = `recurrentes-${new Date().toDateString()}`
    if (sessionStorage.getItem(key)) return
    generateRecurrentesForToday()
      .then((n) => { sessionStorage.setItem(key, '1'); if (n > 0) setRecurrentesBanner(n) })
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


  if (loading) return (
    <>
      <Navbar />
      <div className="max-w-5xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-5xl mx-auto p-4 space-y-6 pb-10">

        {/* Header */}
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tablero</h1>
            <p className="text-gray-500 text-sm capitalize">
              {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
          <NotificationEmailManager notifEmails={notifEmails} />
        </div>

        {/* Alertas accionables */}
        {recurrentesBanner !== null && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Requieren atención</h2>
            <div className="bg-[#E8F5F0] border border-[#B3DDD3] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-accent text-sm">
                ↺ {recurrentesBanner} pedido{recurrentesBanner > 1 ? 's' : ''} recurrente{recurrentesBanner > 1 ? 's' : ''} generado{recurrentesBanner > 1 ? 's' : ''} automáticamente para hoy
              </p>
              <button onClick={() => setRecurrentesBanner(null)} className="text-gray-400 hover:text-gray-700 text-xs">✕</button>
            </div>
          </section>
        )}

        {/* KPIs y métricas */}
        <MetricsDashboard orders={orders} />

        {/* Clima */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Clima — próximos 7 días</h2>
            <Link to="/admin/clima" className="text-xs text-accent hover:underline">Historial →</Link>
          </div>
          <ForecastStrip />
        </section>

        {/* Mapa en vivo */}
        <LiveMapSection orders={orders} />

        {/* Carga por chofer */}
        <ResumenCargaPorChofer orders={orders} choferes={choferes.choferes} />

        {/* Herramienta de pruebas (solo super_admin) */}
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
      </main>
    </div>
  )
}
