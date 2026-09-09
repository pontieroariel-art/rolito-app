import SistemaLayout from './SistemaLayout'
import { LOGISTICA_NAV_GROUPS } from '../../utils/logisticaNav'
import { SISTEMA_LABELS } from '../../utils/sistemas'
import { useAuth } from '../../context/AuthContext'

// Shell del sistema logística/oficina — ver SistemaLayout (chrome común).
export default function LogisticaLayout() {
  const { user } = useAuth()
  // La bandeja de anulaciones de facturas (2026-09-09) la ve quien tiene el
  // permiso individual, sea cual sea su rol; el resto ni la ve en el menú.
  const puedeAutorizarAnulaciones = !!user && (user.autorizaAnulaciones === true || user.rol === 'super_admin')
  return (
    <SistemaLayout
      navGroups={LOGISTICA_NAV_GROUPS}
      subtitulo={({ multiSistema, sistemaActual }) =>
        multiSistema && sistemaActual ? SISTEMA_LABELS[sistemaActual] : undefined}
      filtrarItem={(to) => to !== '/anulaciones' || puedeAutorizarAnulaciones}
    />
  )
}
