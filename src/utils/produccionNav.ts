import { ClipboardList, Factory, LayoutDashboard, Users } from 'lucide-react'
import { NavGroup } from './navGroups'
import { UserRole } from '../types'

// Roles de cada ítem = exactamente el allowedRoles de su <Route> en App.tsx.
//
// "Listado" (/produccion/listado) es una pantalla compartida con gerencia/
// logística/comercial: la MISMA ruta se renderiza dentro de este shell para
// encargado/super_admin (usaShellProduccion) y con el Navbar genérico para el
// resto — ver ProduccionListadoPage.
export const PRODUCCION_NAV_GROUPS: NavGroup[] = [
  {
    id: 'produccion', label: 'Producción',
    items: [
      { to: '/produccion/resumen',   label: 'Resumen',   icon: LayoutDashboard, roles: ['produccion_encargado', 'super_admin'] },
      { to: '/produccion/listado',   label: 'Listado',   icon: ClipboardList,   roles: ['produccion_encargado', 'super_admin'] },
      { to: '/produccion/operarios', label: 'Operarios', icon: Users,           roles: ['produccion_encargado', 'super_admin'] },
    ],
  },
  {
    id: 'configuracion', label: 'Configuración',
    items: [
      { to: '/produccion/plantas', label: 'Plantas', icon: Factory, roles: ['produccion_encargado', 'super_admin'] },
    ],
  },
]

// ¿Este rol ve las pantallas de producción dentro del shell del encargado
// (sidebar de ProduccionLayout)? super_admin entra igual que el encargado —
// consistente con /produccion/operarios, que ya le muestra este sidebar.
// Gerencia/logística/comercial consultan el listado con su Navbar de siempre.
export function usaShellProduccion(rol: UserRole | undefined): boolean {
  return rol === 'produccion_encargado' || rol === 'super_admin'
}
