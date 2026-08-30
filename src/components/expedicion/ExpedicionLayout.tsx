import { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import SistemaLayout from '../layout/SistemaLayout'
import { EXPEDICION_NAV_GROUPS } from '../../utils/expedicionNav'
import { esDispositivoCobranza } from '../../services/expedicionDeviceService'
import { PLANTAS } from '../../types'

// Shell del módulo expedición (rol 'caja' + super_admin) — ver SistemaLayout
// (chrome común). Muestra la planta del usuario en la tarjeta de cuenta, y
// maneja el "puesto de cobranza": una tablet marcada donde, sin importar qué
// usuario de caja se loguee (los turnos rotan en el mismo aparato), solo se ve
// y se puede usar Cobranzas. super_admin queda exento para poder administrar.
export default function ExpedicionLayout({ children }: { children?: ReactNode }) {
  const { user }  = useAuth()
  const location  = useLocation()
  const soloCobranza = esDispositivoCobranza() && user?.rol === 'caja'

  // Guard del puesto de cobranza: cualquier otra ruta de /caja redirige.
  const guard = soloCobranza && location.pathname.startsWith('/caja') && location.pathname !== '/caja/cobranzas'
    ? <Navigate to="/caja/cobranzas" replace />
    : undefined

  return (
    <SistemaLayout
      navGroups={EXPEDICION_NAV_GROUPS}
      subtitulo={({ user }) => user?.planta ? PLANTAS[user.planta].label : undefined}
      filtrarItem={(to) => !soloCobranza || to === '/caja/cobranzas'}
      guard={guard}
    >
      {children}
    </SistemaLayout>
  )
}
