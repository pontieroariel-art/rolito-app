import { Navigate, Link } from 'react-router-dom'
import { ShoppingBag, ChevronRight } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { sistemasDeUsuario } from '../../utils/sistemas'

const ROLE_HOME: Record<string, string> = {
  super_admin:       '/sistema',
  logistica:         '/logistica',
  comercial:         '/comercial',
  gerente_comercial: '/logistica',
  gerente_general:   '/gerente',
  facturacion:       '/movimientos',
  chofer:            '/chofer',
  cliente:           '/dashboard',
  heladeras:         '/heladeras',
  heladeras_encargado: '/heladeras',
  tecnico:           '/tecnico',
  produccion_hielo:  '/produccion',
  produccion_encargado: '/produccion/operarios',
}

export default function Landing() {
  const { user, isInitializing } = useAuth()

  if (isInitializing) return <LoadingSpinner fullScreen />

  if (user) {
    if (user.estado === 'pendiente') return <Navigate to="/pendiente" replace />
    if (user.estado === 'inactivo')  return <Navigate to="/clientes"  replace />
    if (sistemasDeUsuario(user).length > 1) return <Navigate to="/sistema" replace />
    return <Navigate to={ROLE_HOME[user.rol] ?? '/dashboard'} replace />
  }

  return (
    <div className="min-h-screen bg-[#F8F7F2] flex flex-col">

      {/* Cabecera */}
      <div
        className="flex justify-center items-end pt-10 pb-0"
        style={{ background: 'linear-gradient(180deg, #1a6b52 0%, #1D9E75 100%)' }}
      >
        <div className="bg-white rounded-2xl p-2 shadow-lg mb-0 translate-y-1/2">
          <img src="/isotipo-rolito.png" alt="Rolito" className="w-16 h-16 object-contain" />
        </div>
      </div>

      {/* Logo */}
      <div className="bg-white flex flex-col items-center pt-12 pb-5 shadow-sm">
        <img src="/logo-rolito.png" alt="Rolito" width={235} height={80} className="h-20 w-auto object-contain" />
      </div>

      {/* Contenido */}
      <div className="flex-1 flex flex-col items-center px-4 pt-7 pb-8 gap-4">

        <p className="text-gray-500 text-sm text-center">Ingresá para hacer tu pedido</p>

        <div className="w-full max-w-sm">
          <Link
            to="/clientes"
            className="flex items-center gap-4 bg-white rounded-2xl border border-[#D3D1C7] shadow-sm hover:border-accent hover:shadow-md active:scale-[0.98] transition-all p-4 group"
          >
            {/* Ícono */}
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-accent/10 text-accent transition-colors">
              <ShoppingBag size={20} strokeWidth={1.75} />
            </div>

            {/* Texto */}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-0.5 text-accent transition-colors">
                Clientes
              </p>
              <h2 className="text-base font-bold text-gray-900 group-hover:text-accent transition-colors leading-tight">
                Ingreso Clientes
              </h2>
              <p className="text-gray-500 text-xs mt-0.5 leading-snug">Pedidos con CUIT y contraseña</p>
            </div>

            {/* Flecha */}
            <ChevronRight size={20} className="shrink-0 transition-all group-hover:translate-x-0.5 text-accent" />
          </Link>
        </div>

        {/* Puertas internas (choferes, equipo Rolito) — a propósito discretas:
            esta pantalla es la de un cliente pidiendo hielo, no un menú de
            todos los sistemas de la empresa. */}
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link to="/choferes" className="text-xs text-gray-400 hover:text-accent transition-colors">
            Ingreso Choferes
          </Link>
          <span className="text-gray-300">·</span>
          <Link to="/empresa" className="text-xs text-gray-400 hover:text-accent transition-colors">
            Equipo Rolito
          </Link>
        </div>
      </div>
    </div>
  )
}
