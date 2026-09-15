import { Link } from 'react-router-dom'
import { ArrowLeft, CloudOff, Eye, EyeOff, LayoutDashboard, LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { logoutUser } from '@/services/authService'
import { useSistema } from '@/context/SistemaContext'
import { useOnline } from '@/hooks/useOnline'
import { useCobranzasSinSubir } from '@/hooks/useCobranzasSinSubir'
import { usePrivacidad } from '@/hooks/usePrivacidad'
import { homeDeSistema } from '@/utils/sistemas'

// Header compacto del supervisor (mismo patrón que ChoferHeader): en Inicio
// muestra el saludo + salir; en las tareas (Cobrar, Clientes) una flecha para
// volver. `volverA` permite que la ficha vuelva a la lista de clientes y no al
// inicio, que es el recorrido real de la calle. Alto fijo 56px.
export default function SupervisorHeader({ title, back = false, volverA = '/supervisor' }: { title?: string; back?: boolean; volverA?: string }) {
  const { user } = useAuth()
  const { sistemaActual, sistemasDisponibles } = useSistema()
  const { privado, alternar } = usePrivacidad()
  // Quien entró desde la oficina (super_admin desde Comercial › Supervisores) tiene
  // que poder volver. El supervisor de calle no lo ve aunque tenga un dominio por un
  // rol adicional (2026-09-15, pedido de Ariel): sus pantallas de oficina las abre
  // desde las tarjetas de su inicio, dentro de su app.
  const dominio = sistemaActual && sistemasDisponibles.includes(sistemaActual) ? sistemaActual : sistemasDisponibles[0]
  const volverAOficina = user && user.rol !== 'supervisor' && dominio ? homeDeSistema(dominio, user) : null
  return (
    <div className="sticky top-0 z-30">
      <header className="min-h-14 pt-[env(safe-area-inset-top)] bg-white border-b border-[#D3D1C7] flex items-center gap-2 px-3">
        {back ? (
          <Link to={volverA} aria-label="Volver"
            className="w-11 h-11 shrink-0 rounded-xl border border-[#D3D1C7] flex items-center justify-center active:scale-90 transition-transform">
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
            <p className="text-xs text-secundario leading-tight">Supervisor de cobranzas</p>
          )}
        </div>
        {/* Modo privacidad: el mostrador con gente mirando el teléfono. */}
        <button onClick={alternar} aria-label={privado ? 'Mostrar importes' : 'Ocultar importes'}
          title={privado ? 'Mostrar importes' : 'Ocultar importes'}
          className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center active:scale-90 transition-transform ${privado ? 'text-accent bg-accent/10' : 'text-secundario hover:text-gray-700'}`}>
          {privado ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
        {volverAOficina && (
          <Link to={volverAOficina} title="Volver a la oficina"
            className="h-11 px-3 shrink-0 rounded-xl border border-[#D3D1C7] flex items-center gap-1.5 text-sm text-gray-600 hover:text-accent hover:border-accent transition-colors">
            <LayoutDashboard size={18} />
            <span className="hidden sm:inline">Oficina</span>
          </Link>
        )}
        <button onClick={() => logoutUser()} aria-label="Cerrar sesión"
          className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-secundario hover:text-gray-700 active:scale-90 transition-transform">
          <LogOut size={20} />
        </button>
      </header>
      <FranjaConexion />
    </div>
  )
}

/**
 * Sin señal / cobranzas en cola, en TODAS las pantallas del supervisor
 * (2026-09-13). Antes el aviso vivía solo en el inicio, y la duda "¿se guardó?"
 * aparece justo después de cobrar, en la calle.
 *
 * Cuando todo subió no se muestra nada: un verde permanente se vuelve paisaje y
 * deja de leerse.
 */
function FranjaConexion() {
  const online = useOnline()
  const sinSubir = useCobranzasSinSubir()
  if (online && sinSubir === 0) return null
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium ${online ? 'bg-amber-50 text-amber-800' : 'bg-amber-100 text-amber-900'}`}>
      <CloudOff size={14} className="shrink-0" />
      {!online
        ? <span>Sin señal · lo que cobres se guarda en el teléfono y se sube solo</span>
        : <span>{sinSubir === 1 ? '1 cobranza guardada en el teléfono, subiendo…' : `${sinSubir} cobranzas guardadas en el teléfono, subiendo…`}</span>}
    </div>
  )
}
