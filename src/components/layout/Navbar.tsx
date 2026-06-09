import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, CalendarDays, Activity, AlertTriangle,
  Truck, Users, Tag, Map, Cloud, Package, Navigation, BarChart2,
  DollarSign, TrendingUp, Clock, Home, Plus, History, UserCircle,
  LogOut, Menu, X,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { logoutUser } from '../../services/authService'
import { UserRole } from '../../types'

interface NavLinkItem {
  to:    string
  label: string
  icon:  React.ComponentType<{ size?: number; strokeWidth?: number }>
}

const NAV_LINKS: Record<UserRole, NavLinkItem[]> = {
  gerente_comercial: [
    { to: '/usuarios',                     label: 'Clientes',        icon: Users },
    { to: '/movimientos',                  label: 'Movimientos',     icon: BarChart2 },
    { to: '/comercial/historial-precios',  label: 'Hist. precios',   icon: Clock },
    { to: '/comercial/reporte-precios',    label: 'Rep. precios',    icon: DollarSign },
    { to: '/comercial/ventas',             label: 'Rep. ventas',     icon: TrendingUp },
  ],
  cliente: [
    { to: '/dashboard',    label: 'Inicio',        icon: Home },
    { to: '/nuevo-pedido', label: 'Nuevo pedido',  icon: Plus },
    { to: '/historial',    label: 'Historial',     icon: History },
    { to: '/perfil',       label: 'Mi perfil',     icon: UserCircle },
  ],
  super_admin: [
    { to: '/admin',                         label: 'Tablero',       icon: LayoutDashboard },
    { to: '/admin/planificacion',           label: 'Planificación', icon: CalendarDays },
    { to: '/admin/monitoreo',               label: 'Monitoreo',     icon: Activity },
    { to: '/admin/incidencias',             label: 'Incidencias',   icon: AlertTriangle },
    { to: '/admin/flota',                   label: 'Flota',         icon: Truck },
    { to: '/admin/clima',                   label: 'Clima',         icon: Cloud },
    { to: '/usuarios',                      label: 'Usuarios',      icon: Users },
    { to: '/admin/mapa-clientes',           label: 'Mapa clientes', icon: Map },
    { to: '/comercial/mapa',                label: 'En vivo',       icon: Navigation },
    { to: '/movimientos',                   label: 'Movimientos',   icon: BarChart2 },
    { to: '/admin/precios',                 label: 'Precios',       icon: Tag },
    { to: '/comercial/reporte-precios',     label: 'Rep. precios',  icon: DollarSign },
    { to: '/comercial/ventas',              label: 'Ventas',        icon: TrendingUp },
    { to: '/comercial/historial-precios',   label: 'Hist. precios', icon: Clock },
  ],
  logistica: [
    { to: '/logistica',           label: 'Tablero',        icon: LayoutDashboard },
    { to: '/admin/monitoreo',     label: 'Monitoreo',      icon: Activity },
    { to: '/admin/flota',         label: 'Flota',          icon: Truck },
    { to: '/admin/clima',         label: 'Clima',          icon: Cloud },
    { to: '/admin/mapa-clientes', label: 'Mapa clientes',  icon: Map },
  ],
  comercial: [
    { to: '/comercial',                   label: 'Tablero',        icon: LayoutDashboard },
    { to: '/admin/planificacion',         label: 'Planificación',  icon: CalendarDays },
    { to: '/usuarios',                    label: 'Clientes',       icon: Users },
    { to: '/admin/mapa-clientes',         label: 'Mapa clientes',  icon: Map },
    { to: '/movimientos',                 label: 'Movimientos',    icon: BarChart2 },
    { to: '/comercial/reporte-precios',   label: 'Precios',        icon: DollarSign },
    { to: '/comercial/mapa',              label: 'En vivo',        icon: Navigation },
  ],
  facturacion: [
    { to: '/movimientos',                  label: 'Historial',      icon: BarChart2 },
    { to: '/comercial/ventas',             label: 'Ventas',         icon: TrendingUp },
    { to: '/comercial/reporte-precios',    label: 'Precios',        icon: DollarSign },
    { to: '/comercial/historial-precios',  label: 'Hist. precios',  icon: Clock },
    { to: '/usuarios',                     label: 'Clientes',       icon: Users },
    { to: '/admin/mapa-clientes',          label: 'Mapa clientes',  icon: Map },
  ],
  chofer: [
    { to: '/chofer',     label: 'Inicio',       icon: Home },
    { to: '/chofer/map', label: 'Ver ruta',     icon: Navigation },
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
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      <div className="px-3 flex items-stretch justify-between h-16">

        {/* Logo */}
        <Link to="/" className="flex items-center shrink-0 pr-3">
          <img src="/logo-rolito.png" alt="Rolito" className="h-9 object-contain" />
        </Link>

        {/* Links desktop */}
        <div className="hidden md:flex items-stretch flex-1 overflow-x-auto gap-0.5" style={{ scrollbarWidth: 'none' }}>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 px-3.5 border-b-2 transition-all shrink-0 ${
                  isActive
                    ? 'border-accent text-accent'
                    : 'border-transparent text-gray-400 hover:text-gray-700 hover:border-gray-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <l.icon size={18} strokeWidth={isActive ? 2.2 : 1.75} />
                  <span className="text-[10px] font-medium leading-none whitespace-nowrap">{l.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>

        {/* Usuario desktop */}
        <div className="hidden md:flex items-center gap-2 pl-3 border-l border-gray-100 ml-2 shrink-0">
          <div className="text-right">
            <p className="text-xs font-semibold text-gray-800 leading-tight">
              {user?.nombre?.split(' ')[0]}
            </p>
            {user?.rol && (
              <p className="text-[10px] text-gray-400 leading-tight">{ROLE_LABELS[user.rol]}</p>
            )}
          </div>
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-xs font-bold shrink-0">
            {initials}
          </div>
          <button
            onClick={handleLogout}
            title="Cerrar sesión"
            className="text-gray-300 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-50"
          >
            <LogOut size={15} />
          </button>
        </div>

        {/* Hamburger mobile */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="md:hidden flex items-center text-gray-400 hover:text-gray-700 p-1.5"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Menú mobile */}
      {open && (
        <div id="mobile-menu" className="md:hidden border-t border-gray-100 bg-white">
          <div className="grid grid-cols-4 gap-1 p-3">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-1 rounded-xl py-3 px-1 transition-colors text-center ${
                    isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <l.icon size={20} strokeWidth={isActive ? 2.2 : 1.75} />
                    <span className="text-[10px] font-medium leading-none">{l.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
          <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-white text-xs font-bold">
                {initials}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-800">{user?.nombre?.split(' ')[0]}</p>
                <p className="text-[10px] text-gray-400">{user?.rol && ROLE_LABELS[user.rol]}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-400 transition-colors"
            >
              <LogOut size={14} />
              Salir
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
