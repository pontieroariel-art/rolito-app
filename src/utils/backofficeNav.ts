import { LayoutDashboard, UserCog, Settings } from 'lucide-react'
import { NavGroup } from './navGroups'

// Navegación del Backoffice (`/admin/*`, BackofficeLayout) — exclusivo
// super_admin por ahora. A diferencia de logisticaNav/heladerasNav, acá
// entran solo las pantallas que YA son 100% privativas de super_admin (no
// las que además usa un rol operativo a diario — esas se quedan en su
// layout de siempre, solo reagrupadas bajo "Configuración"). Operarios de
// producción se mudó a ProduccionLayout (produccion_encargado la gestiona
// también, ya no es exclusiva de super_admin) — sigue linkeada desde
// BackofficeHome como cross-link, igual que Flota/Modelos.
export const BACKOFFICE_NAV_GROUPS: NavGroup[] = [
  {
    id: 'backoffice', label: 'Administración',
    items: [
      { to: '/admin',                    label: 'Inicio',           icon: LayoutDashboard, roles: ['super_admin'] },
      { to: '/admin/usuarios',           label: 'Usuarios & Roles', icon: UserCog,         roles: ['super_admin'] },
      { to: '/admin/general',            label: 'Ajustes generales', icon: Settings,       roles: ['super_admin'] },
    ],
  },
]
