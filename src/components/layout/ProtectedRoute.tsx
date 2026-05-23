import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { UserRole } from '../../types'

interface ProtectedRouteProps {
  allowedRoles?: UserRole[]
}

// Se monta SOLO cuando loading = false (garantizado por AppContent en App.tsx).
// Sin useEffect, sin navigate(), sin dependencias problemáticas.
// user es estable: Firebase ya respondió antes de que este componente exista.

export default function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user } = useAuth()

  if (!user)                       return <Navigate to="/"          replace />
  if (user.estado === 'pendiente') return <Navigate to="/pendiente" replace />
  if (user.estado === 'inactivo')  return <Navigate to="/"          replace />
  if (allowedRoles && !allowedRoles.includes(user.rol))
                                   return <Navigate to="/"          replace />

  return <Outlet />
}
