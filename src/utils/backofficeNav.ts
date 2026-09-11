import { LayoutDashboard, UserCog, Settings } from 'lucide-react'
import { NavGroup } from './navGroups'
import { NAV_IR_A } from './backofficeAccesos'

// Navegación del Backoffice (`/admin/*`, BackofficeLayout) — exclusivo
// super_admin. Acá entran solo las pantallas que YA son 100% privativas de
// super_admin (no las que además usa un rol operativo a diario — esas se
// quedan en su layout de siempre y se linkean desde los accesos del panel de
// control). El grupo "Ir a" (2026-09-10) es la puerta a cada sistema y a los
// puestos (caja, tesorería, supervisor) que no tenían entrada en ningún menú.
export const BACKOFFICE_NAV_GROUPS: NavGroup[] = [
  {
    id: 'backoffice', label: 'Administración',
    items: [
      { to: '/admin',                    label: 'Panel de control',  icon: LayoutDashboard, roles: ['super_admin'] },
      { to: '/admin/usuarios',           label: 'Usuarios & Roles',  icon: UserCog,         roles: ['super_admin'] },
      { to: '/admin/general',            label: 'Ajustes generales', icon: Settings,        roles: ['super_admin'] },
    ],
  },
  NAV_IR_A,
]
