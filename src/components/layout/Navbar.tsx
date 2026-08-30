import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, CalendarDays, Activity, AlertTriangle, ClipboardList,
  Truck, Users, Tag, Map, Cloud, Package, Navigation, BarChart2,
  DollarSign, TrendingUp, Clock, Home, Plus, History, UserCircle,
  LogOut, Menu, X, Snowflake, Wrench, ArrowLeftRight,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useOnline } from '../../hooks/useOnline'
import { useSistema } from '../../context/SistemaContext'
import { logoutUser } from '../../services/authService'
import { UserRole } from '../../types'
import { SISTEMA_LABELS } from '../../utils/sistemas'

interface NavLinkItem {
  to:    string
  label: string
  icon:  React.ComponentType<{ size?: number; strokeWidth?: number }>
}

const NAV_LINKS: Record<UserRole, NavLinkItem[]> = {
  gerente_general: [
    { to: '/gerente',                       label: 'Tablero',        icon: LayoutDashboard },
    { to: '/admin/monitoreo',               label: 'Monitoreo',      icon: Activity },
    { to: '/usuarios',                      label: 'Clientes',       icon: Users },
    { to: '/admin/mapa-clientes',           label: 'Mapa clientes',  icon: Map },
    { to: '/comercial/ventas',              label: 'Ventas',         icon: TrendingUp },
    { to: '/comercial/historial-precios',   label: 'Hist. precios',  icon: Clock },
  ],
  gerente_comercial: [
    { to: '/logistica',                    label: 'Planificación',   icon: CalendarDays },
    { to: '/admin/historial-despacho',     label: 'Hist. despacho',  icon: History },
    { to: '/admin/monitoreo',              label: 'Monitoreo',       icon: Activity },
    { to: '/admin/clima',                  label: 'Clima',           icon: Cloud },
    { to: '/usuarios',                     label: 'Clientes',        icon: Users },
    { to: '/admin/precios',                label: 'Precios',         icon: Tag },
    { to: '/movimientos',                  label: 'Movimientos',     icon: BarChart2 },
    { to: '/comercial/ventas',             label: 'Ventas',          icon: TrendingUp },
  ],
  cliente: [
    { to: '/dashboard',      label: 'Inicio',         icon: Home },
    { to: '/nuevo-pedido',   label: 'Nuevo pedido',   icon: Plus },
    { to: '/historial',      label: 'Historial',      icon: History },
    { to: '/mis-heladeras',  label: 'Mis heladeras',  icon: Snowflake },
    { to: '/perfil',         label: 'Mi perfil',      icon: UserCircle },
  ],
  // super_admin ya no llega a ninguna pantalla que use este Navbar genérico
  // (administra desde BackofficeLayout, y conserva Flota/Precios/Modelos/
  // etc. dentro de LogisticaLayout/HeladerasLayout, que tienen su propio
  // chrome) — ver plan de migración del Backoffice. Se deja vacío en vez de
  // borrar la key porque UserRole exige que NAV_LINKS cubra los 12 roles.
  super_admin: [],
  logistica: [
    { to: '/logistica',           label: 'Planificación',  icon: CalendarDays },
    { to: '/admin/historial-despacho', label: 'Hist. despacho', icon: History },
    { to: '/admin/monitoreo',     label: 'Monitoreo',      icon: Activity },
    { to: '/admin/visitas',       label: 'Visitas',        icon: ClipboardList },
    { to: '/admin/flota',         label: 'Flota',          icon: Truck },
    { to: '/admin/precios',       label: 'Precios',        icon: Tag },
    { to: '/admin/clima',         label: 'Clima',          icon: Cloud },
    { to: '/usuarios',            label: 'Clientes',       icon: Users },
    { to: '/admin/mapa-clientes', label: 'Mapa clientes',  icon: Map },
  ],
  comercial: [
    { to: '/comercial',                   label: 'Tablero',        icon: LayoutDashboard },
    { to: '/usuarios',                    label: 'Clientes',       icon: Users },
    { to: '/admin/mapa-clientes',         label: 'Mapa clientes',  icon: Map },
    { to: '/movimientos',                 label: 'Movimientos',    icon: BarChart2 },
    { to: '/admin/precios',               label: 'Precios',        icon: Tag },
    { to: '/comercial/reporte-precios',   label: 'Rep. precios',   icon: DollarSign },
    { to: '/comercial/mapa',              label: 'Reparto',        icon: Navigation },
  ],
  facturacion: [
    { to: '/movimientos',                  label: 'Movimientos',    icon: BarChart2 },
    { to: '/comercial/ventas',             label: 'Ventas',         icon: TrendingUp },
    { to: '/comercial/reporte-precios',    label: 'Rep. precios',   icon: DollarSign },
    { to: '/comercial/historial-precios',  label: 'Hist. precios',  icon: Clock },
    { to: '/usuarios',                     label: 'Clientes',       icon: Users },
    { to: '/admin/mapa-clientes',          label: 'Mapa clientes',  icon: Map },
  ],
  chofer: [
    { to: '/chofer',       label: 'Inicio',       icon: Home },
    { to: '/chofer/venta', label: 'Vender',       icon: Package },
    { to: '/chofer/map',   label: 'Ruta',         icon: Navigation },
  ],
  heladeras: [
    { to: '/heladeras', label: 'Heladeras', icon: Snowflake },
  ],
  heladeras_encargado: [
    { to: '/heladeras', label: 'Heladeras', icon: Snowflake },
  ],
  tecnico: [
    { to: '/tecnico', label: 'Mis service', icon: Wrench },
  ],
  produccion_hielo: [
    { to: '/produccion', label: 'Cargar producción', icon: Package },
  ],
  // produccion_encargado tiene su propio ProduccionLayout (con sidebar
  // propio, igual que Logística/Heladeras) — no usa este Navbar genérico.
  produccion_encargado: [],
  // caja usa ExpedicionLayout (sidebar propio) — no usa este Navbar genérico.
  caja: [],
  muelle: [
    { to: '/muelle', label: 'Muelle', icon: Package },
  ],
  seguridad: [
    { to: '/seguridad', label: 'Salidas', icon: Truck },
  ],
}

// Link set para el sistema "heladeras" de los roles con más de un sistema
// (super_admin, gerente_comercial, comercial) — ver src/utils/sistemas.ts.
const HELADERAS_LINKS: NavLinkItem[] = [
  { to: '/heladeras', label: 'Heladeras', icon: Snowflake },
]

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:        'Super Admin',
  gerente_general:    'Gte. General',
  gerente_comercial:  'Gte. Comercial',
  comercial:          'Comercial',
  logistica:          'Logística',
  facturacion:        'Facturación',
  chofer:             'Chofer',
  cliente:            'Cliente',
  heladeras:          'Heladeras',
  heladeras_encargado: 'Enc. Heladeras',
  tecnico:            'Técnico',
  produccion_hielo:   'Producción',
  produccion_encargado: 'Enc. Producción',
  caja:               'Caja',
  muelle:             'Muelle',
  seguridad:          'Seguridad',
}

export default function Navbar() {
  const { user }        = useAuth()
  const online          = useOnline()
  const navigate        = useNavigate()
  const [open, setOpen] = useState(false)
  const { sistemasDisponibles, sistemaActual, cambiarSistema } = useSistema()

  const multiSistema = sistemasDisponibles.length > 1
  const links = user?.rol
    ? (multiSistema && sistemaActual === 'heladeras' ? HELADERAS_LINKS : NAV_LINKS[user.rol])
    : []

  const initials = user?.nombre
    ? user.nombre.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
    : '?'

  // ProtectedRoute redirige a "/" apenas la sesión se cierra (antes de que
  // cualquier navigate() propio alcance a ejecutarse — pierde la carrera
  // contra ese redirect). Por eso acá no se decide el destino: Landing.tsx
  // ("/") es quien sabe, vía localStorage, si ESTE dispositivo es una
  // tablet de planta y manda de vuelta a produccion-{planta} en vez de
  // mostrar el landing genérico (Clientes/Choferes/Equipo Rolito).
  const handleLogout = async () => {
    await logoutUser()
    navigate('/')
  }

  const handleCambiarSistema = () => {
    cambiarSistema()
    navigate('/sistema')
  }

  return (
    <>
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm pt-[env(safe-area-inset-top)]">
      <div className="px-3 flex items-stretch justify-between h-[72px]">

        {/* Logo */}
        <Link to="/" className="flex items-center shrink-0 pr-4">
          <img src="/logo-rolito.png" alt="Rolito" width={118} height={40} className="h-10 w-auto object-contain" />
        </Link>

        {/* Links desktop */}
        <div
          className="hidden md:flex items-stretch flex-1 overflow-x-auto gap-1 [&::-webkit-scrollbar]:h-[3px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 hover:[&::-webkit-scrollbar-thumb]:bg-gray-400"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#d1d5db transparent' }}
        >
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1.5 px-4 border-b-[3px] transition-all shrink-0 ${
                  isActive
                    ? 'border-accent text-accent'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <l.icon size={22} strokeWidth={isActive ? 2.2 : 1.75} />
                  <span className="text-[11px] font-semibold leading-none whitespace-nowrap">{l.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>

        {/* Usuario desktop */}
        <div className="hidden md:flex items-center gap-2 pl-3 border-l border-gray-100 ml-2 shrink-0">
          <div className="text-right">
            <p className="text-sm font-semibold text-gray-800 leading-tight">
              {user?.nombre?.split(' ')[0]}
            </p>
            {user?.rol && (
              <p className="text-xs text-gray-500 leading-tight">
                {ROLE_LABELS[user.rol]}{multiSistema && sistemaActual ? ` · ${SISTEMA_LABELS[sistemaActual]}` : ''}
              </p>
            )}
          </div>
          <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white text-sm font-bold shrink-0">
            {initials}
          </div>
          {multiSistema && (
            <button
              onClick={handleCambiarSistema}
              title="Cambiar de sistema"
              className="text-gray-400 hover:text-accent transition-colors p-2 rounded-lg hover:bg-accent/10"
            >
              <ArrowLeftRight size={17} />
            </button>
          )}
          <button
            onClick={handleLogout}
            title="Cerrar sesión"
            className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50"
          >
            <LogOut size={17} />
          </button>
        </div>

        {/* Hamburger mobile */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="md:hidden flex items-center justify-center w-11 h-11 -mr-1.5 text-gray-600 hover:text-gray-900"
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Banner sin conexión — los writes se encolan y sincronizan al volver */}
      {!online && (
        <div className="bg-amber-500 text-white text-xs font-medium text-center px-4 py-1.5">
          Sin conexión — los cambios se guardan y se sincronizan al reconectar.
        </div>
      )}

      {/* Menú mobile */}
      {open && (
        <div id="mobile-menu" className="md:hidden border-t border-gray-100 bg-white">
          <div className="grid grid-cols-4 gap-1.5 p-3">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-1.5 rounded-xl py-3.5 px-1 transition-colors text-center ${
                    isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <l.icon size={24} strokeWidth={isActive ? 2.2 : 1.75} />
                    <span className="text-[11px] font-semibold leading-none">{l.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
          <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white text-sm font-bold">
                {initials}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">{user?.nombre?.split(' ')[0]}</p>
                <p className="text-xs text-gray-500">
                  {user?.rol && ROLE_LABELS[user.rol]}{multiSistema && sistemaActual ? ` · ${SISTEMA_LABELS[sistemaActual]}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {multiSistema && (
                <button
                  onClick={() => { setOpen(false); handleCambiarSistema() }}
                  className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-accent transition-colors"
                >
                  <ArrowLeftRight size={16} />
                  Sistema
                </button>
              )}
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-red-500 transition-colors"
              >
                <LogOut size={16} />
                Salir
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>

    {/* Bottom nav — solo cliente: es quien más pide hielo desde el celular
        con una sola mano, y sus 5 secciones entran cómodas en una tab bar
        fija (mismo patrón que ya usa ChoferDashboard/ChoferMap). El resto de
        los roles sigue navegando por el menú hamburguesa de arriba. */}
    {user?.rol === 'cliente' && (
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 flex shadow-[0_-1px_8px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)]">
        {NAV_LINKS.cliente.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-[11px] font-medium transition-colors ${
                isActive ? 'text-accent' : 'text-gray-400 hover:text-gray-700'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <l.icon size={20} strokeWidth={isActive ? 2.2 : 1.75} />
                <span>{l.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    )}
    </>
  )
}
