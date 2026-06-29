import { Navigate, Link } from 'react-router-dom'
import { ShoppingBag, Truck, Building2, ChevronRight } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'

const ROLE_HOME: Record<string, string> = {
  super_admin:       '/admin',
  logistica:         '/logistica',
  comercial:         '/comercial',
  gerente_comercial: '/usuarios',
  facturacion:       '/movimientos',
  chofer:            '/chofer',
  cliente:           '/dashboard',
}

const CARDS = [
  {
    to:          '/clientes',
    label:       'Clientes',
    title:       'Ingreso Clientes',
    description: 'Pedidos con CUIT y contraseña',
    icon:        ShoppingBag,
    accent:      true,
  },
  {
    to:          '/choferes',
    label:       'Choferes',
    title:       'Ingreso Choferes',
    description: 'Acceso con DNI y PIN',
    icon:        Truck,
    accent:      false,
  },
  {
    to:          '/empresa',
    label:       'Equipo Rolito',
    title:       'Ingreso Empresa',
    description: 'Admin, comercial, logística',
    icon:        Building2,
    accent:      false,
  },
]

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
        <img src="/logo-rolito.png" alt="Rolito" className="h-20 object-contain" />
      </div>

      {/* Contenido */}
      <div className="flex-1 flex flex-col items-center px-4 pt-7 pb-8 gap-4">

        <p className="text-gray-500 text-sm text-center">Seleccioná cómo querés ingresar</p>

        <div className="w-full max-w-sm space-y-3">
          {CARDS.map(({ to, label, title, description, icon: Icon, accent }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-4 bg-white rounded-2xl border border-[#D3D1C7] shadow-sm hover:border-accent hover:shadow-md active:scale-[0.98] transition-all p-4 group"
            >
              {/* Ícono */}
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                accent ? 'bg-accent/10 text-accent' : 'bg-gray-100 text-gray-500 group-hover:bg-accent/10 group-hover:text-accent'
              } transition-colors`}>
                <Icon size={20} strokeWidth={1.75} />
              </div>

              {/* Texto */}
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] font-semibold uppercase tracking-widest mb-0.5 ${
                  accent ? 'text-accent' : 'text-gray-400 group-hover:text-accent'
                } transition-colors`}>
                  {label}
                </p>
                <h2 className="text-base font-bold text-gray-900 group-hover:text-accent transition-colors leading-tight">
                  {title}
                </h2>
                <p className="text-gray-500 text-xs mt-0.5 leading-snug">{description}</p>
              </div>

              {/* Flecha */}
              <ChevronRight
                size={20}
                className={`shrink-0 transition-all group-hover:translate-x-0.5 ${
                  accent ? 'text-accent' : 'text-gray-300 group-hover:text-accent'
                }`}
              />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
