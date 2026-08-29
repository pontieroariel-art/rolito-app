import { ClipboardList, HandCoins, Scale, ShoppingCart } from 'lucide-react'
import { NavGroup } from './navGroups'

// Roles de cada ítem = exactamente el allowedRoles de su <Route> en App.tsx
// (misma regla que logisticaNav/heladerasNav/produccionNav).
export const EXPEDICION_NAV_GROUPS: NavGroup[] = [
  {
    id: 'expedicion', label: 'Expedición',
    items: [
      { to: '/caja/remitos',       label: 'Remitos de carga', icon: ClipboardList, roles: ['caja', 'super_admin'] },
      { to: '/caja/ventanilla',    label: 'Ventanilla',       icon: ShoppingCart,  roles: ['caja', 'super_admin'] },
      { to: '/caja/cobranzas',     label: 'Cobranzas',        icon: HandCoins,     roles: ['caja', 'super_admin'] },
      { to: '/caja/liquidaciones', label: 'Liquidaciones',    icon: Scale,         roles: ['caja', 'super_admin'] },
    ],
  },
]
