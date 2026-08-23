import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Menu, X, ArrowLeftRight, LogOut } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useOnline } from '../../hooks/useOnline'
import { useSistema } from '../../context/SistemaContext'
import { logoutUser } from '../../services/authService'
import { ROLE_LABELS } from './Navbar'
import { BACKOFFICE_NAV_GROUPS } from '../../utils/backofficeNav'
import { SISTEMA_LABELS } from '../../utils/sistemas'

// Shell del Backoffice (`/admin/*`) — mismo esqueleto que LogisticaLayout/
// HeladerasLayout (sidebar-como-nav, sin Navbar arriba). A diferencia de
// esos dos, hoy solo lo pisa super_admin: es el panel de administración,
// separado de los tableros operativos de cada módulo.
export default function BackofficeLayout() {
  const { user }   = useAuth()
  const online     = useOnline()
  const navigate   = useNavigate()
  const [open, setOpen] = useState(false)
  const { sistemasDisponibles, sistemaActual, cambiarSistema } = useSistema()
  const multiSistema = sistemasDisponibles.length > 1

  const grupos = BACKOFFICE_NAV_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => user && i.roles.includes(user.rol)),
    }))
    .filter((g) => g.items.length > 0)

  const initials = user?.nombre
    ? user.nombre.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
    : '?'

  const handleLogout = async () => {
    await logoutUser()
    navigate('/')
  }

  const handleCambiarSistema = () => {
    cambiarSistema()
    navigate('/sistema')
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
      isActive ? 'bg-accent/10 text-accent font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`

  const cuenta = (
    <>
      <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-xs font-bold shrink-0">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-800 truncate">{user?.nombre?.split(' ')[0]}</p>
        <p className="text-xs text-gray-500 truncate">
          {user?.rol && ROLE_LABELS[user.rol]}{multiSistema && sistemaActual ? ` · ${SISTEMA_LABELS[sistemaActual]}` : ''}
        </p>
      </div>
      {multiSistema && (
        <button
          onClick={handleCambiarSistema}
          title="Cambiar de sistema"
          className="text-gray-400 hover:text-accent transition-colors p-1.5 rounded-lg hover:bg-accent/10 shrink-0"
        >
          <ArrowLeftRight size={16} />
        </button>
      )}
      <button
        onClick={handleLogout}
        title="Cerrar sesión"
        className="text-gray-400 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50 shrink-0"
      >
        <LogOut size={16} />
      </button>
    </>
  )

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      {!online && (
        <div className="bg-amber-500 text-white text-xs font-medium text-center px-4 py-1.5">
          Sin conexión — los cambios se guardan y se sincronizan al reconectar.
        </div>
      )}
      <div className="md:flex">

      {/* Franja mínima — mobile/tablet angosto */}
      <div className="md:hidden sticky top-0 z-40 bg-white border-b border-[#D3D1C7] px-3 min-h-12 pt-[env(safe-area-inset-top)] flex items-center justify-between">
        <Link to="/admin" className="flex items-center">
          <img src="/logo-rolito.png" alt="Rolito" width={71} height={24} className="h-6 w-auto object-contain" />
        </Link>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          className="text-gray-600 p-3 -mr-3 flex items-center justify-center"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}
      {open && (
        <div className="md:hidden fixed inset-x-0 top-[calc(3rem+env(safe-area-inset-top))] z-40 max-h-[calc(100dvh-3rem-env(safe-area-inset-top))] overflow-y-auto border-b border-[#D3D1C7] bg-white px-4 py-3 space-y-4 shadow-lg">
          <p className="text-[11px] uppercase tracking-wide text-accent font-semibold px-1">Backoffice</p>
          {grupos.map((g) => (
            <div key={g.id}>
              <div className="space-y-0.5">
                {g.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end onClick={() => setOpen(false)} className={linkClass}>
                    <item.icon size={16} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
          <div className="border-t border-gray-100 pt-3 flex items-center gap-2">
            {cuenta}
          </div>
        </div>
      )}

      {/* Sidebar — única navegación en desktop/tablet ancho, sin Navbar arriba */}
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-[#D3D1C7] bg-white sticky top-0 h-screen">
        <Link to="/admin" className="flex items-center px-4 h-16 border-b border-[#D3D1C7] shrink-0">
          <img src="/logo-rolito.png" alt="Rolito" width={94} height={32} className="h-8 w-auto object-contain" />
        </Link>
        <p className="text-[11px] uppercase tracking-wide text-accent font-semibold px-6 pt-4">Backoffice</p>

        <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
          {grupos.map((g) => (
            <div key={g.id}>
              <div className="space-y-0.5">
                {g.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end className={linkClass}>
                    <item.icon size={16} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[#D3D1C7] p-3 flex items-center gap-2 shrink-0">
          {cuenta}
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
      </div>
    </div>
  )
}
