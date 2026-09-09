import { Activity, Ban, History, Landmark, Scale, ShieldCheck } from 'lucide-react'
import { NavGroup } from './navGroups'

// Roles de cada ítem = exactamente el allowedRoles de su <Route> en App.tsx
// (misma regla que expedicionNav). Tesorería (2026-09-09): tablero en vivo de
// lo que se vende y cobra, validación de rendiciones e historial.
export const TESORERIA_NAV_GROUPS: NavGroup[] = [
  {
    id: 'tesoreria', label: 'Tesorería',
    items: [
      { to: '/tesoreria',                       label: 'En vivo',     icon: Activity,    roles: ['tesoreria', 'super_admin', 'gerente_general'] },
      { to: '/tesoreria/liquidaciones',         label: 'Liquidaciones', icon: Scale,     roles: ['tesoreria', 'super_admin', 'gerente_general'] },
      { to: '/tesoreria/rendiciones',           label: 'Rendiciones', icon: ShieldCheck, roles: ['tesoreria', 'super_admin', 'gerente_general'] },
      { to: '/tesoreria/entregas',              label: 'Entregas',    icon: Landmark,    roles: ['tesoreria', 'super_admin', 'gerente_general'] },
      { to: '/tesoreria/anulaciones',           label: 'Anulaciones', icon: Ban,         roles: ['tesoreria', 'super_admin', 'gerente_general'] },
      { to: '/tesoreria/rendiciones/historial', label: 'Historial',   icon: History,     roles: ['tesoreria', 'super_admin', 'gerente_general'] },
    ],
  },
]
