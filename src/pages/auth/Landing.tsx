import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'

const ROLE_HOME: Record<string, string> = {
  super_admin: '/admin',
  logistica:   '/logistica',
  comercial:   '/comercial',
  facturacion: '/movimientos',
  chofer:      '/chofer',
  cliente:     '/dashboard',
}

export default function Landing() {
  const { user, isInitializing } = useAuth()

  if (isInitializing) return <LoadingSpinner fullScreen />

  if (user) {
    if (user.estado === 'pendiente') return <Navigate to="/pendiente" replace />
    if (user.estado === 'inactivo')  return <Navigate to="/clientes"  replace />
    return <Navigate to={ROLE_HOME[user.rol] ?? '/dashboard'} replace />
  }

  return (
    <div className="min-h-screen bg-[#F8F7F2] flex flex-col">

      {/* Cabecera con gradiente */}
      <div
        className="flex justify-center items-end pt-10 pb-0"
        style={{ background: 'linear-gradient(180deg, #081C11 0%, #2D6A4F 100%)' }}
      >
        <div className="bg-white rounded-2xl p-2 shadow-lg mb-0 translate-y-1/2">
          <img src="/isotipo-rolito.png" alt="Rolito" className="w-16 h-16 object-contain" />
        </div>
      </div>

      {/* Logo */}
      <div className="bg-white flex flex-col items-center pt-12 pb-6 shadow-sm">
        <img src="/logo-rolito.png" alt="Rolito" className="h-24 object-contain" />
      </div>

      {/* Contenido */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 gap-6">

        <p className="text-gray-500 text-sm text-center">Seleccioná cómo querés ingresar</p>

        <div className="w-full max-w-sm space-y-3">

          {/* Ingreso Clientes */}
          <Link
            to="/clientes"
            className="block bg-white rounded-2xl border border-[#D3D1C7] shadow-sm hover:border-accent hover:shadow-md transition-all p-5 group"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-accent uppercase tracking-widest mb-1">
                  Clientes
                </p>
                <h2 className="text-lg font-bold text-gray-900 group-hover:text-accent transition-colors">
                  Ingreso Clientes
                </h2>
                <p className="text-gray-500 text-sm mt-0.5">
                  Gestioná tus pedidos con CUIT y contraseña
                </p>
              </div>
              <span className="text-accent text-xl shrink-0 group-hover:translate-x-1 transition-transform">
                →
              </span>
            </div>
          </Link>

          {/* Ingreso Choferes */}
          <Link
            to="/choferes"
            className="block bg-white rounded-2xl border border-[#D3D1C7] shadow-sm hover:border-accent hover:shadow-md transition-all p-5 group"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">
                  Choferes
                </p>
                <h2 className="text-lg font-bold text-gray-900 group-hover:text-accent transition-colors">
                  Ingreso Choferes
                </h2>
                <p className="text-gray-500 text-sm mt-0.5">
                  Acceso con CUIT y PIN para repartidores
                </p>
              </div>
              <span className="text-gray-400 text-xl shrink-0 group-hover:text-accent group-hover:translate-x-1 transition-all">
                →
              </span>
            </div>
          </Link>

          {/* Ingreso Empresa */}
          <Link
            to="/empresa"
            className="block bg-white rounded-2xl border border-[#D3D1C7] shadow-sm hover:border-accent hover:shadow-md transition-all p-5 group"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">
                  Equipo Rolito
                </p>
                <h2 className="text-lg font-bold text-gray-900 group-hover:text-accent transition-colors">
                  Ingreso Empresa
                </h2>
                <p className="text-gray-500 text-sm mt-0.5">
                  Administración, comercial, logística y facturación
                </p>
              </div>
              <span className="text-gray-400 text-xl shrink-0 group-hover:text-accent group-hover:translate-x-1 transition-all">
                →
              </span>
            </div>
          </Link>
        </div>

      </div>
    </div>
  )
}
