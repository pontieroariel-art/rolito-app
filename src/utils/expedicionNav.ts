import { ClipboardList, HandCoins, History, Landmark, Scale, ShoppingCart, Truck, Wallet, Warehouse } from 'lucide-react'
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
      { to: '/caja/rendiciones',   label: 'Mi caja',          icon: Wallet,        roles: ['caja', 'super_admin'] },
      { to: '/caja/entregas',      label: 'Entrega a tesorería', icon: Landmark,   roles: ['caja', 'super_admin'] },
      { to: '/caja/liquidaciones/historial', label: 'Historial', icon: History,  roles: ['caja', 'super_admin', 'gerente_general'] },
      // Un cajero con el rol adicional muelle/seguridad (2026-09-12: caja carga la
      // descarga mientras muelle no tiene tablet) llega a esos paneles desde acá.
      { to: '/muelle',    label: 'Muelle (descarga)', icon: Warehouse, roles: ['muelle'] },
      { to: '/seguridad', label: 'Seguridad (salidas)', icon: Truck,  roles: ['seguridad'] },
    ],
  },
]
