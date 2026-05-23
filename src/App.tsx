import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { BranchProvider, useBranch } from './context/BranchContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoadingSpinner from './components/ui/LoadingSpinner'

import Landing         from './pages/auth/Landing'
import LoginClientes   from './pages/auth/LoginClientes'
import LoginEmpresa    from './pages/auth/LoginEmpresa'
import LoginChofer     from './pages/auth/LoginChofer'
import Register        from './pages/auth/Register'
import ForgotPassword  from './pages/auth/ForgotPassword'
import PendingApproval from './pages/auth/PendingApproval'

import ClientDashboard  from './pages/client/ClientDashboard'
import NewOrder         from './pages/client/NewOrder'
import OrderHistory     from './pages/client/OrderHistory'
import ClientProfile    from './pages/client/ClientProfile'
import SelectSucursal   from './pages/client/SelectSucursal'

import AdminDashboard  from './pages/admin/AdminDashboard'
import UserManagement  from './pages/admin/UserManagement'
import PriceListsPage  from './pages/admin/PriceListsPage'
import FlotaPage          from './pages/admin/FlotaPage'
import VisitasPage        from './pages/admin/VisitasPage'
import PlanificacionPage  from './pages/admin/PlanificacionPage'
import MonitoreoPage          from './pages/admin/MonitoreoPage'
import ReporteIncidenciasPage from './pages/admin/ReporteIncidenciasPage'
import ClimaPage              from './pages/admin/ClimaPage'

import ComercialDashboard   from './pages/comercial/ComercialDashboard'
import ComercialOrders      from './pages/comercial/ComercialOrders'
import ReportePreciosPage    from './pages/comercial/ReportePreciosPage'
import ReporteVentasPage    from './pages/comercial/ReporteVentasPage'
import HistorialPreciosPage from './pages/comercial/HistorialPreciosPage'
import HistorialPage        from './pages/shared/HistorialPage'

import ChoferDashboard from './pages/chofer/ChoferDashboard'
import ChoferMap       from './pages/chofer/ChoferMap'


// ── ClientBranchGuard ─────────────────────────────────────────────────────────
// Redirige a /sucursal si el cliente tiene múltiples sucursales y no eligió.

function ClientBranchGuard() {
  const { needsSelection } = useBranch()
  if (needsSelection) return <Navigate to="/sucursal" replace />
  return <Outlet />
}

// ── AppContent ────────────────────────────────────────────────────────────────
// Mientras isInitializing = true → solo spinner.
// Una vez que onAuthStateChanged corrió y Firestore cargó, las rutas se
// renderizan y nunca se desmontan por transiciones de auth posteriores.

function AppContent() {
  const { isInitializing } = useAuth()
  if (isInitializing) return <LoadingSpinner fullScreen />
  return (
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
        <Route path="/admin"          element={<AdminDashboard />} />
        <Route path="/admin/precios"  element={<PriceListsPage />} />
        <Route path="/admin/flota"          element={<FlotaPage />} />
        <Route path="/admin/visitas"        element={<VisitasPage />} />
        <Route path="/admin/planificacion"  element={<PlanificacionPage />} />
        <Route path="/admin/monitoreo"      element={<MonitoreoPage />} />
        <Route path="/admin/incidencias"    element={<ReporteIncidenciasPage />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica', 'comercial']} />}>
        <Route path="/admin/clima" element={<ClimaPage />} />
      </Route>

      {/* Gestión de usuarios */}
      <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_comercial', 'comercial', 'facturacion']} />}>
        <Route path="/usuarios" element={<UserManagement />} />
      </Route>

      {/* Comercial */}
      <Route element={<ProtectedRoute allowedRoles={['comercial']} />}>
        <Route path="/comercial"         element={<ComercialDashboard />} />
        <Route path="/comercial/pedidos" element={<ComercialOrders />} />
      </Route>

      {/* Reportes: comercial + gerente + super_admin + facturacion */}
      <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_comercial', 'comercial', 'facturacion']} />}>
        <Route path="/comercial/reporte-precios"  element={<ReportePreciosPage />} />
        <Route path="/comercial/ventas"           element={<ReporteVentasPage />} />
      </Route>

      {/* Historial de precios */}
      <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_comercial', 'comercial', 'logistica', 'facturacion']} />}>
        <Route path="/comercial/historial-precios" element={<HistorialPreciosPage />} />
      </Route>

      {/* Historial unificado */}
      <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_comercial', 'logistica', 'comercial', 'facturacion']} />}>
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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BranchProvider>
          <BrowserRouter>
            <AppContent />
          </BrowserRouter>
        </BranchProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
