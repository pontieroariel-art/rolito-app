import {
  Snowflake, Truck, Wrench, Search, Map, Package, Layers,
  BarChart2, TrendingUp, Users, ClipboardList,
} from 'lucide-react'
import { NavGroup } from './navGroups'

// Roles de cada ítem = exactamente el allowedRoles de su <Route> en App.tsx —
// el sidebar nunca debe ofrecer un link al que ProtectedRoute le va a negar
// el paso. Si cambia el allowedRoles de una ruta, actualizar acá también.
export const HELADERAS_NAV_GROUPS: NavGroup[] = [
  {
    id: 'operaciones', label: 'Operaciones',
    items: [
      { to: '/heladeras/taller',     label: 'Tablero de taller',     icon: Snowflake, roles: ['heladeras', 'heladeras_encargado', 'super_admin', 'gerente_comercial'] },
      { to: '/heladeras/asignacion', label: 'Asignación de equipos', icon: Truck,     roles: ['heladeras_encargado', 'super_admin', 'gerente_comercial', 'comercial'] },
    ],
  },
  {
    id: 'service', label: 'Soporte & Service',
    items: [
      { to: '/heladeras/toma-service',     label: 'Toma de service',     icon: Wrench, roles: ['heladeras_encargado', 'super_admin', 'gerente_comercial'] },
      { to: '/heladeras/consulta-service', label: 'Consulta de service', icon: Search, roles: ['heladeras_encargado', 'super_admin', 'gerente_comercial'] },
      { to: '/heladeras/mapa',             label: 'Mapa y preventivos',  icon: Map,    roles: ['heladeras_encargado', 'super_admin', 'gerente_comercial'] },
    ],
  },
  {
    id: 'activos', label: 'Activos & Stock',
    items: [
      { to: '/heladeras/equipos', label: 'Padrón de equipos',  icon: Package, roles: ['heladeras_encargado', 'super_admin', 'gerente_comercial'] },
      { to: '/heladeras/modelos', label: 'Modelos',            icon: Layers,  roles: ['heladeras_encargado', 'super_admin', 'gerente_comercial'] },
      { to: '/heladeras/panol',   label: 'Pañol de repuestos', icon: Package, roles: ['heladeras_encargado', 'super_admin', 'gerente_comercial'] },
    ],
  },
  {
    id: 'gestion', label: 'Gestión & Config',
    items: [
      { to: '/heladeras/informes',  label: 'Informes y métricas',  icon: BarChart2,     roles: ['heladeras_encargado', 'super_admin', 'gerente_comercial'] },
      { to: '/heladeras/ranking',   label: 'Ranking de consumo',   icon: TrendingUp,    roles: ['heladeras_encargado', 'super_admin', 'gerente_comercial', 'comercial'] },
      { to: '/heladeras/tecnicos',  label: 'Técnicos',             icon: Users,         roles: ['heladeras_encargado', 'super_admin', 'gerente_comercial'] },
      { to: '/heladeras/catalogos', label: 'Catálogos de service', icon: ClipboardList, roles: ['heladeras_encargado', 'super_admin', 'gerente_comercial'] },
    ],
  },
]
