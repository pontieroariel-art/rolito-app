import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoadingSpinner from './components/ui/LoadingSpinner'

import Login          from './pages/auth/Login'
import Register       from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'

import ClientDashboard from './pages/client/ClientDashboard'
import NewOrder        from './pages/client/NewOrder'
import OrderHistory    from './pages/client/OrderHistory'
import ClientProfile   from './pages/client/ClientProfile'

import AdminDashboard from './pages/admin/AdminDashboard'

import ChoferDashboard from './pages/chofer/ChoferDashboard'
import ChoferMap       from './pages/chofer/ChoferMap'

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
          <Route path="/login"           element={<Login />} />
          <Route path="/register"        element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          <Route path="/" element={<RoleRouter />} />

          <Route element={<ProtectedRoute allowedRoles={['cliente']} />}>
            <Route path="/dashboard"    element={<ClientDashboard />} />
            <Route path="/nuevo-pedido" element={<NewOrder />} />
            <Route path="/historial"    element={<OrderHistory />} />
            <Route path="/perfil"       element={<ClientProfile />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
            <Route path="/admin" element={<AdminDashboard />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['chofer']} />}>
            <Route path="/chofer"     element={<ChoferDashboard />} />
            <Route path="/chofer/map" element={<ChoferMap />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
