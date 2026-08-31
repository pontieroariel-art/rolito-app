import { Link } from 'react-router-dom'
import { ArrowLeft, LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { logoutUser } from '@/services/authService'

// Header compacto del supervisor (mismo patrón que ChoferHeader): en Inicio
// muestra el saludo + salir; en las tareas (Cobrar, Clientes) una flecha para
// volver al Inicio. Alto fijo 56px.
export default function SupervisorHeader({ title, back = false }: { title?: string; back?: boolean }) {
  const { user } = useAuth()
  return (
    <header className="h-14 bg-white border-b border-[#D3D1C7] flex items-center gap-3 px-3 sticky top-0 z-30">
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
      <button onClick={() => logoutUser()} aria-label="Cerrar sesión"
        className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 active:scale-90 transition-transform">
        <LogOut size={20} />
      </button>
    </header>
  )
}
