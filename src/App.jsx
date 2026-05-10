import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoadingSpinner from './components/ui/LoadingSpinner'

// Auth
import Login          from './pages/auth/Login'
import Register       from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'

// Cliente
import ClientDashboard from './pages/client/ClientDashboard'
import NewOrder        from './pages/client/NewOrder'
import OrderHistory    from './pages/client/OrderHistory'
import ClientProfile   from './pages/client/ClientProfile'

// Admin
import AdminDashboard from './pages/admin/AdminDashboard'

// Chofer
import ChoferDashboard from './pages/chofer/ChoferDashboard'
import ChoferMap       from './pages/chofer/ChoferMap'

// Redirige a la pantalla correcta según el rol del usuario autenticado
function RoleRouter() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingSpinner fullScreen />
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'admin')  return <Navigate to="/admin"  replace />
  if (user.role === 'chofer') return <Navigate to="/chofer" replace />
  return <Navigate to="/dashboard" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Rutas públicas */}
          <Route path="/login"           element={<Login />} />
          <Route path="/register"        element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          {/* Raíz: redirige según rol */}
          <Route path="/" element={<RoleRouter />} />

          {/* Rutas del cliente */}
          <Route element={<ProtectedRoute allowedRoles={['cliente']} />}>
            <Route path="/dashboard"    element={<ClientDashboard />} />
            <Route path="/nuevo-pedido" element={<NewOrder />} />
            <Route path="/historial"    element={<OrderHistory />} />
            <Route path="/perfil"       element={<ClientProfile />} />
          </Route>

          {/* Rutas del admin */}
          <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
            <Route path="/admin" element={<AdminDashboard />} />
          </Route>

          {/* Rutas del chofer */}
          <Route element={<ProtectedRoute allowedRoles={['chofer']} />}>
            <Route path="/chofer"     element={<ChoferDashboard />} />
            <Route path="/chofer/map" element={<ChoferMap />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
