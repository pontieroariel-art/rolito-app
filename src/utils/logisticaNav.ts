import {
  LayoutDashboard, CalendarDays, History, Activity, AlertTriangle, ClipboardList,
  Truck, Cloud, Navigation, Users, Map, Tag, DollarSign, TrendingUp, Clock, BarChart2,
} from 'lucide-react'
import { NavGroup } from './navGroups'

// Deduplicado del NAV_LINKS por rol de Navbar.tsx (ver ese archivo) agrupado
// en 3 categorías. Los roles de cada ítem son EXACTAMENTE los que ya
// mostraban ese link ahí — no necesariamente los mismos que allowedRoles de
// la <Route> en App.tsx permite (hay huecos preexistentes entre nav y ruta,
// ej. gerente_comercial puede visitar /comercial/reporte-precios por URL
// pero nunca tuvo ese link en su Navbar; comercial puede visitar
// /comercial/ventas pero tampoco lo tenía). Se portan tal cual, no se
// "arreglan" acá — ver plan de este cambio para el detalle.
export const LOGISTICA_NAV_GROUPS: NavGroup[] = [
  {
    id: 'operacion', label: 'Operación',
    items: [
      { to: '/admin',               label: 'Tablero',       icon: LayoutDashboard, roles: ['super_admin'] },
      { to: '/comercial',           label: 'Tablero',       icon: LayoutDashboard, roles: ['comercial'] },
      { to: '/gerente',             label: 'Tablero',       icon: LayoutDashboard, roles: ['gerente_general'] },
      { to: '/admin/planificacion', label: 'Planificación', icon: CalendarDays,    roles: ['super_admin'] },
      { to: '/logistica',           label: 'Planificación', icon: CalendarDays,    roles: ['logistica', 'gerente_comercial'] },
      { to: '/admin/historial-despacho', label: 'Hist. despacho', icon: History,        roles: ['super_admin', 'logistica', 'gerente_comercial'] },
      { to: '/admin/monitoreo',          label: 'Monitoreo',      icon: Activity,       roles: ['super_admin', 'logistica', 'gerente_general', 'gerente_comercial'] },
      { to: '/admin/incidencias',        label: 'Incidencias',    icon: AlertTriangle,  roles: ['super_admin', 'logistica'] },
      { to: '/admin/visitas',            label: 'Visitas',        icon: ClipboardList,  roles: ['super_admin', 'logistica'] },
      { to: '/admin/flota',              label: 'Flota',          icon: Truck,          roles: ['super_admin', 'logistica'] },
      { to: '/admin/clima',              label: 'Clima',          icon: Cloud,          roles: ['super_admin', 'logistica', 'gerente_comercial', 'comercial'] },
      { to: '/comercial/mapa',           label: 'Reparto',        icon: Navigation,     roles: ['comercial'] },
    ],
  },
  {
    id: 'clientes', label: 'Clientes & Precios',
    items: [
      { to: '/usuarios',                 label: 'Usuarios',      icon: Users,      roles: ['super_admin'] },
      { to: '/usuarios',                 label: 'Clientes',      icon: Users,      roles: ['gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'] },
      { to: '/admin/mapa-clientes',      label: 'Mapa clientes', icon: Map,        roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'] },
      { to: '/admin/precios',            label: 'Precios',       icon: Tag,        roles: ['super_admin', 'logistica', 'gerente_comercial', 'comercial'] },
      { to: '/comercial/reporte-precios', label: 'Rep. precios', icon: DollarSign, roles: ['super_admin', 'gerente_general', 'comercial', 'facturacion'] },
      { to: '/comercial/historial-precios', label: 'Hist. precios', icon: Clock,   roles: ['super_admin', 'gerente_general', 'facturacion'] },
    ],
  },
  {
    id: 'reportes', label: 'Reportes',
    items: [
      { to: '/movimientos',       label: 'Movimientos', icon: BarChart2,  roles: ['super_admin', 'gerente_comercial', 'comercial', 'facturacion'] },
      { to: '/comercial/ventas',  label: 'Ventas',       icon: TrendingUp, roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'facturacion'] },
    ],
  },
]
