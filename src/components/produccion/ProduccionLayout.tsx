import { ReactNode } from 'react'
import SistemaLayout from '../layout/SistemaLayout'
import { PRODUCCION_NAV_GROUPS } from '../../utils/produccionNav'

// Shell del módulo producción — ver SistemaLayout (chrome común). Acepta
// children además de <Outlet/> para las pantallas compartidas con otros roles
// (Listado) que no viven anidadas bajo la ruta del layout — ver
// ProduccionListadoPage. El subtítulo de cuenta queda solo con el rol (sin
// planta ni sistema), como venía.
export default function ProduccionLayout({ children }: { children?: ReactNode }) {
  return <SistemaLayout navGroups={PRODUCCION_NAV_GROUPS}>{children}</SistemaLayout>
}
