import { ReactNode } from 'react'
import SistemaLayout from '../layout/SistemaLayout'
import { TESORERIA_NAV_GROUPS } from '../../utils/tesoreriaNav'

// Shell de tesorería (rol 'tesoreria' + super_admin; gerente_general lee) —
// ver SistemaLayout (chrome común). Sin planta: tesorería mira las dos.
export default function TesoreriaLayout({ children }: { children?: ReactNode }) {
  return (
    <SistemaLayout navGroups={TESORERIA_NAV_GROUPS} subtitulo={() => 'Tesorería'}>
      {children}
    </SistemaLayout>
  )
}
