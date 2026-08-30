import SistemaLayout from '../layout/SistemaLayout'
import { HELADERAS_NAV_GROUPS } from '../../utils/heladerasNav'
import { SISTEMA_LABELS } from '../../utils/sistemas'

// Shell del módulo heladeras — ver SistemaLayout (chrome común).
export default function HeladerasLayout() {
  return (
    <SistemaLayout
      navGroups={HELADERAS_NAV_GROUPS}
      subtitulo={({ multiSistema, sistemaActual }) =>
        multiSistema && sistemaActual ? SISTEMA_LABELS[sistemaActual] : undefined}
    />
  )
}
