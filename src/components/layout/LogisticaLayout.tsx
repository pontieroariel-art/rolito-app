import SistemaLayout from './SistemaLayout'
import { LOGISTICA_NAV_GROUPS } from '../../utils/logisticaNav'
import { SISTEMA_LABELS } from '../../utils/sistemas'

// Shell del sistema logística/oficina — ver SistemaLayout (chrome común).
export default function LogisticaLayout() {
  return (
    <SistemaLayout
      navGroups={LOGISTICA_NAV_GROUPS}
      subtitulo={({ multiSistema, sistemaActual }) =>
        multiSistema && sistemaActual ? SISTEMA_LABELS[sistemaActual] : undefined}
    />
  )
}
