import { ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, LogOut, Menu, Search, UserCog, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useOnline } from '@/hooks/useOnline'
import { useSistema } from '@/context/SistemaContext'
import { logoutUser } from '@/services/authService'
import { esDispositivoCobranza } from '@/services/expedicionDeviceService'
import { ROLE_LABELS, tieneAlgunRol, tieneRol } from '@/utils/roles'
import { SISTEMA_LABELS, homeDeSistema } from '@/utils/sistemas'
import { gruposDe, sistemaDeRuta, estaEnSidebar } from '@/rutas/catalogo'
import { PLANTAS, Sistema } from '@/types'
import ClimaWidget from './ClimaWidget'
import BuscadorRapido, { ItemBuscable } from './BuscadorRapido'

// Shell único de escritorio (fase 2 del reordenamiento, 2026-09-12): un solo
// marco para los cuatro dominios — Logística, Heladeras, Comercial y
// Administración. Reemplaza a SistemaLayout + Logistica/Heladeras/Produccion/
// Expedicion/Tesoreria/BackofficeLayout.
//
//  - El sidebar muestra los grupos del dominio ACTIVO (src/rutas/catalogo.ts →
//    SIDEBARS), filtrados por rol, roles adicionales y pestañas permitidas.
//  - Dominio activo = el elegido por el usuario mientras la ruta esté en su
//    sidebar; si llega por link/push/URL a una pantalla de otro dominio, el
//    shell pasa a ese dominio solo (y lo recuerda).
//  - Cabecera: selector de dominio, buscador (Ctrl/⌘ K), clima y cuenta.
//  - Botón al pie para colapsar el sidebar a íconos (se recuerda por navegador).
//  - Guardas heredadas: el puesto de cobranza (tablet marcada) solo ve
//    Cobranzas; la bandeja /anulaciones solo la ve quien puede autorizar.
//  - `children` sirve para pantallas que se montan fuera del <Outlet/>.

const CLAVE_COLAPSADO = 'sidebarColapsado'

function leerColapsado(): boolean {
  try { return localStorage.getItem(CLAVE_COLAPSADO) === '1' } catch { return false }
}

export default function DominioLayout({ children }: { children?: ReactNode }) {
  const { user } = useAuth()
  const online   = useOnline()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { sistemasDisponibles, sistemaActual, elegirSistema } = useSistema()
  const [open, setOpen] = useState(false)
  const [colapsado, setColapsado] = useState(leerColapsado)
  const [buscando, setBuscando] = useState(false)

  const soloCobranza = esDispositivoCobranza() && tieneRol(user, 'caja')
  const puedeAutorizarAnulaciones = !!user && (user.autorizaAnulaciones === true || user.rol === 'super_admin')

  // Dominio activo: el elegido si esta ruta está en su menú; si no, el de la ruta.
  const activo: Sistema = useMemo(() => {
    if (sistemaActual && estaEnSidebar(sistemaActual, pathname)) return sistemaActual
    return sistemaDeRuta(pathname) ?? sistemaActual ?? sistemasDisponibles[0] ?? 'logistica'
  }, [sistemaActual, pathname, sistemasDisponibles])

  useEffect(() => {
    if (activo !== sistemaActual && sistemasDisponibles.includes(activo)) elegirSistema(activo)
  }, [activo, sistemaActual, sistemasDisponibles, elegirSistema])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setBuscando((b) => !b) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const visible = (to: string) =>
    (!soloCobranza || to === '/caja/cobranzas')
    && (to !== '/anulaciones' || puedeAutorizarAnulaciones)
    && (!user?.pestanasPermitidas || user.pestanasPermitidas.includes(to))

  const grupos = useMemo(() => gruposDe(activo)
    .map((g) => ({ ...g, items: g.items.filter((i) => user && tieneAlgunRol(user, i.roles) && visible(i.to)) }))
    .filter((g) => g.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activo, user, soloCobranza, puedeAutorizarAnulaciones])

  // Dominios del selector: los del usuario, más el activo si llegó a uno ajeno por URL.
  const dominios = useMemo(() => (sistemasDisponibles.includes(activo) ? sistemasDisponibles : [...sistemasDisponibles, activo]), [sistemasDisponibles, activo])

  const buscables: ItemBuscable[] = useMemo(() => {
    const out: ItemBuscable[] = []
    const vistos = new Set<string>()
    for (const s of dominios) {
      for (const g of gruposDe(s)) for (const i of g.items) {
        if (vistos.has(i.to) || !user || !tieneAlgunRol(user, i.roles) || !visible(i.to)) continue
        vistos.add(i.to)
        out.push({ to: i.to, label: i.label, icon: i.icon, grupo: g.label, sistema: s })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dominios, user, soloCobranza, puedeAutorizarAnulaciones])

  const irADominio = (s: Sistema) => {
    elegirSistema(s)
    setOpen(false)
    if (user) navigate(homeDeSistema(s, user))
  }

  const toggleColapsado = () => {
    setColapsado((c) => { try { localStorage.setItem(CLAVE_COLAPSADO, c ? '0' : '1') } catch { /* sin storage */ } return !c })
  }

  const handleLogout = async () => {
    await logoutUser()
    navigate('/')
  }

  // Guard del puesto de cobranza: cualquier otra ruta de /caja redirige.
  if (soloCobranza && pathname.startsWith('/caja') && pathname !== '/caja/cobranzas') {
    return <Navigate to="/caja/cobranzas" replace />
  }

  const initials = user?.nombre
    ? user.nombre.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
    : '?'
  const subtitulo = [user?.rol && ROLE_LABELS[user.rol], user?.planta && PLANTAS[user.planta].label].filter(Boolean).join(' · ')
  const homeActivo = user ? homeDeSistema(activo, user) : '/'
  const clima = <ClimaWidget planta={user?.planta} linkAClima={!!user && tieneAlgunRol(user, ['super_admin', 'logistica', 'gerente_comercial', 'comercial'])} />

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-lg text-sm transition-colors ${colapsado ? 'justify-center px-0 py-2' : 'px-2.5 py-2'} ${
      isActive ? 'bg-accent/10 text-accent font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`

  const selectorDominios = (
    <div className="flex items-center gap-1 bg-[#F8F7F2] rounded-lg p-0.5">
      {dominios.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => irADominio(s)}
          aria-current={s === activo ? 'page' : undefined}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${s === activo ? 'bg-white text-accent shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
        >
          {SISTEMA_LABELS[s]}
        </button>
      ))}
    </div>
  )

  const cuenta = (
    <div className="flex items-center gap-2 min-w-0">
      <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-xs font-bold shrink-0">{initials}</div>
      <div className="min-w-0 hidden lg:block">
        <p className="text-sm font-semibold text-gray-800 truncate leading-tight">{user?.nombre?.split(' ')[0]}</p>
        <p className="text-[11px] text-gray-500 truncate leading-tight">{subtitulo}</p>
      </div>
      {user?.rol === 'super_admin' && (
        <Link to="/admin/usuarios" title="Usuarios & Roles" className="text-gray-400 hover:text-accent transition-colors p-1.5 rounded-lg hover:bg-accent/10 shrink-0">
          <UserCog size={16} />
        </Link>
      )}
      <button onClick={handleLogout} title="Cerrar sesión" className="text-gray-400 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50 shrink-0">
        <LogOut size={16} />
      </button>
    </div>
  )

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
      {!online && (
        <div className="bg-amber-500 text-white text-xs font-medium text-center px-4 py-1.5">
          Sin conexión — los cambios se guardan y se sincronizan al reconectar.
        </div>
      )}

      {/* Cabecera de escritorio: logo, dominio, buscador, clima, cuenta */}
      <header className="hidden md:flex items-center gap-3 h-14 px-4 bg-white border-b border-[#D3D1C7]">
        <Link to={homeActivo} className="flex items-center shrink-0">
          <img src="/logo-rolito.png" alt="Rolito" width={82} height={28} className="h-7 w-auto object-contain" />
        </Link>
        {dominios.length > 1
          ? selectorDominios
          : <span className="text-xs font-medium text-gray-500 px-1">{SISTEMA_LABELS[activo]}</span>}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setBuscando(true)}
          className="inline-flex items-center gap-2 text-xs text-gray-500 border border-[#D3D1C7] rounded-lg px-2.5 py-1.5 hover:border-accent hover:text-accent transition-colors"
          title="Buscar una pantalla (Ctrl + K)"
        >
          <Search size={14} />
          <span className="hidden lg:inline">Buscar…</span>
          <kbd className="hidden lg:inline text-[10px] text-gray-400 border border-gray-200 rounded px-1">Ctrl K</kbd>
        </button>
        {clima}
        {cuenta}
      </header>

      {/* Franja mínima — mobile / tablet angosta */}
      <div className="md:hidden sticky top-0 z-40 bg-white border-b border-[#D3D1C7] px-3 min-h-12 pt-[env(safe-area-inset-top)] flex items-center justify-between">
        <Link to={homeActivo} className="flex items-center">
          <img src="/logo-rolito.png" alt="Rolito" width={71} height={24} className="h-6 w-auto object-contain" />
        </Link>
        <button onClick={() => setOpen((o) => !o)} aria-label={open ? 'Cerrar menú' : 'Abrir menú'} className="text-gray-600 p-3 -mr-3 flex items-center justify-center">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && <div className="md:hidden fixed inset-0 z-30 bg-black/40" onClick={() => setOpen(false)} />}
      {open && (
        <div className="md:hidden fixed inset-x-0 top-[calc(3rem+env(safe-area-inset-top))] z-40 max-h-[calc(100dvh-3rem-env(safe-area-inset-top))] overflow-y-auto border-b border-[#D3D1C7] bg-white px-4 py-3 space-y-4 shadow-lg">
          {dominios.length > 1 && selectorDominios}
          {grupos.map((g) => (
            <div key={g.id}>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1 px-1">{g.label}</p>
              <div className="space-y-0.5">
                {g.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end onClick={() => setOpen(false)} className={({ isActive }) => `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm ${isActive ? 'bg-accent/10 text-accent font-medium' : 'text-gray-600'}`}>
                    <item.icon size={16} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
          <div className="border-t border-gray-100 pt-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{user?.nombre?.split(' ')[0]}</p>
              <p className="text-xs text-gray-500 truncate">{subtitulo}</p>
            </div>
            {cuenta}
          </div>
        </div>
      )}

      <div className="md:flex">
        {/* Sidebar de escritorio: navegación del dominio activo, colapsable a íconos */}
        <aside className={`hidden md:flex md:flex-col shrink-0 border-r border-[#D3D1C7] bg-white sticky top-0 h-screen h-dvh transition-[width] duration-150 ${colapsado ? 'w-14' : 'w-60'}`}>
          <nav className={`flex-1 overflow-y-auto overflow-x-hidden ${colapsado ? 'p-2 space-y-3' : 'p-4 space-y-6'}`}>
            {grupos.map((g) => (
              <div key={g.id}>
                {colapsado
                  ? <div className="border-t border-gray-100 mb-2" aria-hidden />
                  : <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-2 px-2.5">{g.label}</p>}
                <div className="space-y-0.5">
                  {g.items.map((item) => (
                    <NavLink key={item.to} to={item.to} end className={linkClass} title={colapsado ? `${item.label} · ${g.label}` : undefined}>
                      <item.icon size={16} className="shrink-0" />
                      {!colapsado && <span className="truncate">{item.label}</span>}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <button
            type="button"
            onClick={toggleColapsado}
            title={colapsado ? 'Expandir menú' : 'Colapsar menú'}
            className="border-t border-[#D3D1C7] h-11 flex items-center justify-center gap-2 text-xs text-gray-500 hover:text-accent hover:bg-accent/5 transition-colors shrink-0"
          >
            {colapsado ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /> Colapsar</>}
          </button>
        </aside>

        <main className="flex-1 min-w-0">
          {children ?? <Outlet />}
        </main>
      </div>

      {buscando && <BuscadorRapido items={buscables} onCerrar={() => setBuscando(false)} />}
    </div>
  )
}
