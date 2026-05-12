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
  cliente: [
    { to: '/dashboard',    label: 'Inicio' },
    { to: '/nuevo-pedido', label: 'Nuevo pedido' },
    { to: '/historial',    label: 'Historial' },
    { to: '/perfil',       label: 'Mi perfil' },
  ],
  super_admin: [
    { to: '/admin',         label: 'Pedidos' },
    { to: '/usuarios',      label: 'Usuarios' },
    { to: '/admin/precios', label: 'Precios' },
  ],
  logistica: [
    { to: '/admin',         label: 'Pedidos' },
    { to: '/admin/precios', label: 'Precios' },
  ],
  comercial: [
    { to: '/comercial', label: 'Panel' },
    { to: '/usuarios',  label: 'Usuarios' },
  ],
  chofer: [
    { to: '/chofer',     label: 'Mis entregas' },
    { to: '/chofer/map', label: 'Ver ruta' },
  ],
}

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  comercial:   'Comercial',
  logistica:   'Logística',
  chofer:      'Chofer',
  cliente:     'Cliente',
}

export default function Navbar() {
  const { user }        = useAuth()
  const navigate        = useNavigate()
  const [open, setOpen] = useState(false)
  const links           = user?.rol ? NAV_LINKS[user.rol] : []

  const handleLogout = async () => {
    await logoutUser()
    navigate('/login')
  }

  return (
    <nav className="bg-surface border-b border-border sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="text-accent font-bold text-xl tracking-tight">
          🧊 Rolito
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `text-sm px-3 py-1.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-muted hover:text-white hover:bg-bg'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
          <div className="ml-3 pl-3 border-l border-border flex items-center gap-3">
            <div className="text-right">
              <span className="text-xs text-white block">{user?.nombre?.split(' ')[0]}</span>
              {user?.rol && (
                <span className="text-xs text-muted">{ROLE_LABELS[user.rol]}</span>
              )}
            </div>
            <button
              onClick={handleLogout}
              className="text-sm text-muted hover:text-red-400 transition-colors"
            >
              Salir
            </button>
          </div>
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          className="md:hidden text-muted hover:text-white p-1"
        >
          {open ? '✕' : '☰'}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-border px-4 py-3 space-y-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block text-sm px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-muted hover:text-white hover:bg-bg'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
          <button
            onClick={handleLogout}
            className="block w-full text-left text-sm text-muted hover:text-red-400 px-3 py-2 transition-colors"
          >
            Salir
          </button>
        </div>
      )}
    </nav>
  )
}
