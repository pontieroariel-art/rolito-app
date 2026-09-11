import { Eye, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { ROLE_LABELS } from './Navbar'
import { cerrarVistaComo } from '../../services/impersonacionService'

// Franja fija de la sesión "Ver como usuario" (2026-09-10). Va arriba de todos
// los layouts (se monta en AppContent) para que el super_admin nunca olvide
// que está mirando la app con la sesión de otra persona, en solo lectura.
// Los headers sticky bajan su altura vía la clase raíz `ver-como` (index.css).
export default function VerComoBanner() {
  const { user, verComo } = useAuth()
  if (!verComo || !user) return null
  const nombre = user.nombre || user.razonSocial || user.email
  return (
    <div
      data-ver-como
      className="sticky top-0 z-[60] h-9 bg-violet-700 text-white text-xs sm:text-sm flex items-center gap-2 px-3 shadow-md"
      role="status"
    >
      <Eye size={15} className="shrink-0" />
      <p className="flex-1 min-w-0 truncate">
        Estás viendo la app como <strong>{nombre}</strong> ({ROLE_LABELS[user.rol] ?? user.rol}) · Solo lectura
      </p>
      <button
        onClick={() => { void cerrarVistaComo() }}
        className="shrink-0 flex items-center gap-1 rounded-md bg-white/15 hover:bg-white/25 px-2 py-1 font-medium transition-colors"
      >
        <X size={14} /> Cerrar vista
      </button>
    </div>
  )
}

// Pantalla de la pestaña "Ver como" cuando ya no hay sesión (el enlace venció
// tras un F5 de más de una hora, o se cerró la sesión).
export function VerComoTerminada() {
  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] flex items-center justify-center p-6">
      <div className="bg-white border border-[#D3D1C7] rounded-2xl shadow-sm p-6 max-w-sm text-center space-y-3">
        <div className="mx-auto w-11 h-11 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center">
          <Eye size={20} />
        </div>
        <h1 className="text-base font-bold text-gray-900">La vista &quot;Ver como&quot; terminó</h1>
        <p className="text-sm text-gray-500">
          El enlace venció o la sesión se cerró. Cerrá esta pestaña y, si querés seguir mirando,
          volvé a abrir &quot;Ver como&quot; desde Usuarios.
        </p>
        <button
          onClick={() => window.close()}
          className="w-full rounded-xl bg-violet-700 text-white text-sm font-medium py-2.5 hover:bg-violet-800 transition-colors"
        >
          Cerrar pestaña
        </button>
      </div>
    </div>
  )
}
