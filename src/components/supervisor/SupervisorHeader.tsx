import { Link } from 'react-router-dom'
import { ArrowLeft, LayoutDashboard, LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { logoutUser } from '@/services/authService'
import { useSistema } from '@/context/SistemaContext'
import { homeDeSistema } from '@/utils/sistemas'

// Header compacto del supervisor (mismo patrón que ChoferHeader): en Inicio
// muestra el saludo + salir; en las tareas (Cobrar, Clientes) una flecha para
// volver al Inicio. Alto fijo 56px.
export default function SupervisorHeader({ title, back = false }: { title?: string; back?: boolean }) {
  const { user } = useAuth()
  const { sistemaActual, sistemasDisponibles } = useSistema()
  // Quien entró desde la oficina (super_admin desde Comercial › Supervisores) tiene
  // que poder volver: el supervisor de calle no tiene dominios y no ve el botón.
  const dominio = sistemaActual && sistemasDisponibles.includes(sistemaActual) ? sistemaActual : sistemasDisponibles[0]
  const volverAOficina = user && dominio ? homeDeSistema(dominio, user) : null
  return (
    <header className="min-h-14 pt-[env(safe-area-inset-top)] bg-white border-b border-[#D3D1C7] flex items-center gap-3 px-3 sticky top-0 z-30">
      {back ? (
        <Link to="/supervisor" aria-label="Volver al inicio"
          className="w-10 h-10 rounded-xl border border-[#D3D1C7] flex items-center justify-center active:scale-90 transition-transform">
          <ArrowLeft size={20} />
        </Link>
      ) : (
        <img src="/isotipo-rolito.png" alt="Rolito" className="w-9 h-9 rounded-lg object-contain" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-tight truncate">
          {title ?? `Hola, ${user?.nombre?.split(' ')[0] ?? 'supervisor'}`}
        </p>
        {!back && (
          <p className="text-xs text-gray-400 leading-tight">Supervisor de cobranzas</p>
        )}
      </div>
      {volverAOficina && (
        <Link to={volverAOficina} title="Volver a la oficina"
          className="h-10 px-3 rounded-xl border border-[#D3D1C7] flex items-center gap-1.5 text-sm text-gray-600 hover:text-accent hover:border-accent transition-colors">
          <LayoutDashboard size={18} />
          <span className="hidden sm:inline">Oficina</span>
        </Link>
      )}
      <button onClick={() => logoutUser()} aria-label="Cerrar sesión"
        className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 active:scale-90 transition-transform">
        <LogOut size={20} />
      </button>
    </header>
  )
}
