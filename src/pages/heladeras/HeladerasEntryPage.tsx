import { useAuth } from '../../context/AuthContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import HeladerasPage from './HeladerasPage'
import HeladerasDashboardPage from './HeladerasDashboardPage'

// El personal de taller (rol 'heladeras') solo tiene una tarea: el tablero
// de depósito/en proceso/revisión, así que entra directo ahí. El resto de
// los roles con acceso al módulo (encargado, super_admin, gerente_comercial,
// comercial) ve el dashboard operativo con KPIs, accesos rápidos y actividad.
export default function HeladerasEntryPage() {
  const { user } = useAuth()
  if (!user) return <LoadingSpinner fullScreen />
  if (user.rol === 'heladeras') return <HeladerasPage />
  return <HeladerasDashboardPage />
}
