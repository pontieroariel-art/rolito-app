import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoadingSpinner from './components/ui/LoadingSpinner'

import Login           from './pages/auth/Login'
import Register        from './pages/auth/Register'
import ForgotPassword  from './pages/auth/ForgotPassword'
import PendingApproval from './pages/auth/PendingApproval'

import ClientDashboard from './pages/client/ClientDashboard'
import NewOrder        from './pages/client/NewOrder'
import OrderHistory    from './pages/client/OrderHistory'
import ClientProfile   from './pages/client/ClientProfile'

import AdminDashboard from './pages/admin/AdminDashboard'
import UserManagement from './pages/admin/UserManagement'

import ComercialDashboard from './pages/comercial/ComercialDashboard'

import ChoferDashboard from './pages/chofer/ChoferDashboard'
import ChoferMap       from './pages/chofer/ChoferMap'

const ROLE_HOME: Record<string, string> = {
  super_admin: '/admin',
  logistica:   '/admin',
  comercial:   '/comercial',
  chofer:      '/chofer',
  cliente:     '/dashboard',
}

// ── RoleRouter ────────────────────────────────────────────────────────────────

function RoleRouter() {
  const { isInitializing, user } = useAuth()

  if (isInitializing)              return <LoadingSpinner fullScreen />
  if (!user)                       return <Navigate to="/login"     replace />
  if (user.estado === 'pendiente') return <Navigate to="/pendiente" replace />
  if (user.estado === 'inactivo')  return <Navigate to="/login"     replace />
  return <Navigate to={ROLE_HOME[user.rol] ?? '/dashboard'} replace />
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
      <Route path="/login"           element={<Login />} />
      <Route path="/register"        element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/pendiente"       element={<PendingApproval />} />

      {/* Redirección según rol */}
      <Route path="/" element={<RoleRouter />} />

      {/* Cliente */}
      <Route element={<ProtectedRoute allowedRoles={['cliente']} />}>
        <Route path="/dashboard"    element={<ClientDashboard />} />
        <Route path="/nuevo-pedido" element={<NewOrder />} />
        <Route path="/historial"    element={<OrderHistory />} />
        <Route path="/perfil"       element={<ClientProfile />} />
      </Route>

      {/* Admin y logística */}
      <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica']} />}>
        <Route path="/admin" element={<AdminDashboard />} />
      </Route>

      {/* Gestión de usuarios */}
      <Route element={<ProtectedRoute allowedRoles={['super_admin', 'comercial']} />}>
        <Route path="/usuarios" element={<UserManagement />} />
      </Route>

      {/* Comercial */}
      <Route element={<ProtectedRoute allowedRoles={['comercial']} />}>
        <Route path="/comercial" element={<ComercialDashboard />} />
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

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  )
}
