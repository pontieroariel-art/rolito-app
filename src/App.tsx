import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { BranchProvider, useBranch } from './context/BranchContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoadingSpinner from './components/ui/LoadingSpinner'
import { Component, ReactNode, ErrorInfo } from 'react'

// Auth pages — carga inmediata (primera pantalla visible)
import Landing         from './pages/auth/Landing'
import LoginClientes   from './pages/auth/LoginClientes'
import LoginEmpresa    from './pages/auth/LoginEmpresa'
import LoginChofer     from './pages/auth/LoginChofer'
import Register        from './pages/auth/Register'
import ForgotPassword  from './pages/auth/ForgotPassword'
import PendingApproval from './pages/auth/PendingApproval'

// Todas las demás páginas — carga bajo demanda
const ClientDashboard  = lazy(() => import('./pages/client/ClientDashboard'))
const NewOrder         = lazy(() => import('./pages/client/NewOrder'))
const OrderHistory     = lazy(() => import('./pages/client/OrderHistory'))
const ClientProfile    = lazy(() => import('./pages/client/ClientProfile'))
const SelectSucursal   = lazy(() => import('./pages/client/SelectSucursal'))

const AdminDashboard      = lazy(() => import('./pages/admin/AdminDashboard'))
const LogisticaDashboard  = lazy(() => import('./pages/admin/LogisticaDashboard'))
const UserManagement      = lazy(() => import('./pages/admin/UserManagement'))
const ClientesMapPage     = lazy(() => import('./pages/admin/ClientesMapPage'))
const PriceListsPage      = lazy(() => import('./pages/admin/PriceListsPage'))
const FlotaPage           = lazy(() => import('./pages/admin/FlotaPage'))
const VisitasPage         = lazy(() => import('./pages/admin/VisitasPage'))
const MonitoreoPage       = lazy(() => import('./pages/admin/MonitoreoPage'))
const ReporteIncidenciasPage = lazy(() => import('./pages/admin/ReporteIncidenciasPage'))
const ClimaPage           = lazy(() => import('./pages/admin/ClimaPage'))

const ComercialDashboard   = lazy(() => import('./pages/comercial/ComercialDashboard'))
const ComercialOrders      = lazy(() => import('./pages/comercial/ComercialOrders'))
const ReportePreciosPage   = lazy(() => import('./pages/comercial/ReportePreciosPage'))
const ReporteVentasPage    = lazy(() => import('./pages/comercial/ReporteVentasPage'))
const HistorialPreciosPage = lazy(() => import('./pages/comercial/HistorialPreciosPage'))
const MapaLivePage         = lazy(() => import('./pages/comercial/MapaLivePage'))
const HistorialPage        = lazy(() => import('./pages/shared/HistorialPage'))

const ChoferDashboard   = lazy(() => import('./pages/chofer/ChoferDashboard'))
const ChoferMap         = lazy(() => import('./pages/chofer/ChoferMap'))
const GerenteDashboard  = lazy(() => import('./pages/gerente/GerenteDashboard'))

// ── ErrorBoundary ─────────────────────────────────────────────────────────────

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Error no capturado:', error, info.componentStack)
    // Chunk stale tras nuevo deploy → recargar automáticamente una vez
    const isChunkError = error.message?.includes('Failed to fetch dynamically imported module')
      || error.message?.includes('Importing a module script failed')
      || error.name === 'ChunkLoadError'
    if (isChunkError && !sessionStorage.getItem('chunk-reload')) {
      sessionStorage.setItem('chunk-reload', '1')
      window.location.reload()
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#F8F7F2', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ maxWidth: '480px', background: '#ffffff', border: '1px solid #D3D1C7', borderRadius: '12px', padding: '32px', color: '#111827' }}>
            <p style={{ fontSize: '22px', fontWeight: 700, color: '#1D9E75', marginBottom: '8px' }}>Rolito</p>
            <p style={{ fontWeight: 600, marginBottom: '12px' }}>Algo salió mal</p>
            <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '20px' }}>
              {(this.state.error as Error).message}
            </p>
            <button
              onClick={() => { sessionStorage.removeItem('chunk-reload'); this.setState({ error: null }); window.location.href = '/' }}
              style={{ background: '#1D9E75', color: '#ffffff', fontWeight: 700, padding: '10px 24px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
            >
              Volver al inicio
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ── ClientBranchGuard ─────────────────────────────────────────────────────────

function ClientBranchGuard() {
  const { needsSelection } = useBranch()
  if (needsSelection) return <Navigate to="/sucursal" replace />
  return <Outlet />
}

// ── AppContent ────────────────────────────────────────────────────────────────

function AppContent() {
  const { isInitializing } = useAuth()
  if (isInitializing) return <LoadingSpinner fullScreen />
  return (
    <Suspense fallback={<LoadingSpinner fullScreen />}>
      <Routes>
        {/* Rutas públicas */}
        <Route path="/"                element={<Landing />} />
        <Route path="/clientes"        element={<LoginClientes />} />
        <Route path="/empresa"         element={<LoginEmpresa />} />
        <Route path="/choferes"        element={<LoginChofer />} />
        <Route path="/login"           element={<Navigate to="/clientes" replace />} />
        <Route path="/register"        element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/pendiente"       element={<PendingApproval />} />

        {/* Cliente */}
        <Route element={<ProtectedRoute allowedRoles={['cliente']} />}>
          <Route path="/sucursal" element={<SelectSucursal />} />
          <Route element={<ClientBranchGuard />}>
            <Route path="/dashboard"    element={<ClientDashboard />} />
            <Route path="/nuevo-pedido" element={<NewOrder />} />
            <Route path="/historial"    element={<OrderHistory />} />
            <Route path="/perfil"       element={<ClientProfile />} />
          </Route>
        </Route>

        {/* Admin y logística */}
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica']} />}>
          <Route path="/admin"                element={<AdminDashboard />} />
          <Route path="/admin/flota"          element={<FlotaPage />} />
          <Route path="/admin/visitas"        element={<VisitasPage />} />
          <Route path="/admin/incidencias"    element={<ReporteIncidenciasPage />} />
        </Route>
        {/* Precios (catálogo + listas): super_admin, logística y comercial */}
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica', 'comercial']} />}>
          <Route path="/admin/precios"        element={<PriceListsPage />} />
        </Route>
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica', 'gerente_comercial']} />}>
          <Route path="/logistica"           element={<LogisticaDashboard />} />
          <Route path="/admin/planificacion" element={<LogisticaDashboard />} />
          <Route path="/admin/clima"         element={<ClimaPage />} />
        </Route>
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica', 'gerente_general', 'gerente_comercial']} />}>
          <Route path="/admin/monitoreo" element={<MonitoreoPage />} />
        </Route>

        {/* Gerente general */}
        <Route element={<ProtectedRoute allowedRoles={['gerente_general']} />}>
          <Route path="/gerente" element={<GerenteDashboard />} />
        </Route>

        {/* Gestión de usuarios */}
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion', 'logistica']} />}>
          <Route path="/usuarios" element={<UserManagement />} />
        </Route>
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion', 'logistica']} />}>
          <Route path="/admin/mapa-clientes" element={<ClientesMapPage />} />
        </Route>

        {/* Comercial */}
        <Route element={<ProtectedRoute allowedRoles={['comercial']} />}>
          <Route path="/comercial"         element={<ComercialDashboard />} />
          <Route path="/comercial/pedidos" element={<ComercialOrders />} />
        </Route>
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'comercial', 'logistica']} />}>
          <Route path="/comercial/mapa" element={<MapaLivePage />} />
        </Route>

        {/* Reportes */}
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion']} />}>
          <Route path="/comercial/reporte-precios"  element={<ReportePreciosPage />} />
          <Route path="/comercial/ventas"           element={<ReporteVentasPage />} />
        </Route>

        {/* Historial de precios */}
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'logistica', 'facturacion']} />}>
          <Route path="/comercial/historial-precios" element={<HistorialPreciosPage />} />
        </Route>

        {/* Historial unificado */}
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion']} />}>
          <Route path="/movimientos" element={<HistorialPage />} />
        </Route>

        {/* Chofer */}
        <Route element={<ProtectedRoute allowedRoles={['chofer']} />}>
          <Route path="/chofer"     element={<ChoferDashboard />} />
          <Route path="/chofer/map" element={<ChoferMap />} />
        </Route>

        {/* Cualquier otra ruta */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            5 * 60_000,
      retry:                1,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BranchProvider>
            <BrowserRouter>
              <AppContent />
            </BrowserRouter>
          </BranchProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
