import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { logoutUser } from '../../services/authService'
import { UserRole } from '../../types'

interface NavLinkItem {
  to: string
  label: string
}

const NAV_LINKS: Record<UserRole, NavLinkItem[]> = {
  gerente_comercial: [
    { to: '/usuarios',                     label: 'Clientes' },
    { to: '/movimientos',                  label: 'Movimientos' },
    { to: '/comercial/historial-precios',  label: 'Hist. precios' },
    { to: '/comercial/reporte-precios',    label: 'Rep. precios' },
    { to: '/comercial/ventas',             label: 'Rep. ventas' },
  ],
  cliente: [
    { to: '/dashboard',    label: 'Inicio' },
    { to: '/nuevo-pedido', label: 'Nuevo pedido' },
    { to: '/historial',    label: 'Historial' },
    { to: '/perfil',       label: 'Mi perfil' },
  ],
  super_admin: [
    { to: '/admin',                           label: 'Pedidos' },
    { to: '/admin/planificacion',             label: 'Planificación' },
    { to: '/admin/monitoreo',                 label: 'Monitoreo' },
    { to: '/admin/incidencias',               label: 'Incidencias' },
    { to: '/admin/visitas',                   label: 'Visitas' },
    { to: '/admin/flota',                     label: 'Flota' },
    { to: '/usuarios',                        label: 'Usuarios' },
    { to: '/admin/precios',                   label: 'Precios' },
    { to: '/comercial/historial-precios',     label: 'Historial precios' },
  ],
  logistica: [
    { to: '/logistica',           label: 'Planificación' },
    { to: '/admin/monitoreo',     label: 'Monitoreo' },
    { to: '/admin/flota',         label: 'Flota' },
    { to: '/admin/clima',         label: 'Clima' },
  ],
  comercial: [
    { to: '/comercial',                      label: 'Panel' },
    { to: '/admin/planificacion',            label: 'Planificación' },
    { to: '/usuarios',                       label: 'Clientes' },
    { to: '/movimientos',                    label: 'Movimientos' },
    { to: '/comercial/reporte-precios',      label: 'Precios' },
    { to: '/comercial/mapa',                 label: 'Mapa en vivo' },
  ],
  facturacion: [
    { to: '/movimientos',                    label: 'Historial' },
    { to: '/comercial/ventas',               label: 'Reporte ventas' },
    { to: '/comercial/reporte-precios',      label: 'Precios' },
    { to: '/comercial/historial-precios',    label: 'Historial precios' },
    { to: '/usuarios',                       label: 'Clientes' },
  ],
  chofer: [
    { to: '/chofer',     label: 'Mis entregas' },
    { to: '/chofer/map', label: 'Ver ruta' },
  ],
}

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:       'Super Admin',
  gerente_comercial: 'Gte. Comercial',
  comercial:         'Comercial',
  logistica:         'Logística',
  facturacion:       'Facturación',
  chofer:            'Chofer',
  cliente:           'Cliente',
}

export default function Navbar() {
  const { user }        = useAuth()
  const navigate        = useNavigate()
  const [open, setOpen] = useState(false)
  const links           = user?.rol ? NAV_LINKS[user.rol] : []

  const initials = user?.nombre
    ? user.nombre.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
    : '?'

  const handleLogout = async () => {
    await logoutUser()
    navigate('/login')
  }

  return (
    <nav className="bg-white border-b-2 border-accent sticky top-0 z-40 shadow-sm">
      <div className="max-w-5xl mx-auto px-4 flex items-stretch justify-between h-14">

        {/* Logo */}
        <Link to="/" className="flex items-center">
          <img src="/logo-rolito.png" alt="Rolito" className="h-8 object-contain" />
        </Link>

        {/* Links desktop */}
        <div className="hidden md:flex items-stretch gap-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `flex items-center text-sm font-medium px-4 border-b-2 transition-colors ${
                  isActive
                    ? 'border-accent text-accent'
                    : 'border-transparent text-gray-400 hover:text-gray-700 hover:border-gray-200'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>

        {/* Usuario desktop */}
        <div className="hidden md:flex items-center gap-3">
          <div className="text-right">
            <span className="text-xs font-semibold text-gray-700 block leading-tight">
              {user?.nombre?.split(' ')[0]}
            </span>
            {user?.rol && (
              <span className="text-xs text-gray-400 leading-tight">{ROLE_LABELS[user.rol]}</span>
            )}
          </div>
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {initials}
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-red-400 transition-colors border border-gray-200 hover:border-red-200 rounded-lg px-3 py-1.5"
          >
            Salir
          </button>
        </div>

        {/* Hamburger mobile */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="md:hidden flex items-center text-gray-400 hover:text-gray-700 p-1"
        >
          {open ? '✕' : '☰'}
        </button>
      </div>

      {/* Menú mobile */}
      {open && (
        <div id="mobile-menu" className="md:hidden border-t border-gray-100 px-4 py-3 space-y-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block text-sm px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
          <div className="pt-2 border-t border-gray-100 flex items-center justify-between px-3 py-2">
            <span className="text-xs text-gray-500">{user?.nombre?.split(' ')[0]} · {user?.rol && ROLE_LABELS[user.rol]}</span>
            <button
              onClick={handleLogout}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors"
            >
              Salir
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
