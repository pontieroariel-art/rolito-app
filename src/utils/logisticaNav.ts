import {
  LayoutDashboard, CalendarDays, History, Activity, AlertTriangle, ClipboardList,
  Truck, Cloud, Navigation, Users, UserCog, Map, Tag, DollarSign, TrendingUp, Clock, BarChart2,
} from 'lucide-react'
import { NavGroup } from './navGroups'

// Basado en el NAV_LINKS por rol que tenía Navbar.tsx, con los huecos entre
// nav y allowedRoles de App.tsx ya cerrados (roles que podían entrar a una
// pantalla por URL pero nunca tuvieron el link: Reparto para super_admin/
// logistica, Rep. precios para gerente_comercial, Ventas para comercial,
// Hist. precios para gerente_comercial/comercial/logistica, Movimientos
// para gerente_general/logistica). Quedan deliberadamente sin agregar
// /admin (Tablero) para logistica — su home real es Planificación — y
// /comercial/pedidos, que no tiene nav propio (se llega desde un link
// contextual en el tablero comercial).
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
      { to: '/comercial/mapa',           label: 'Reparto',        icon: Navigation,     roles: ['super_admin', 'logistica', 'comercial'] },
    ],
  },
  {
    id: 'clientes', label: 'Clientes & Precios',
    items: [
      { to: '/usuarios',                 label: 'Clientes',      icon: Users,      roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'] },
      { to: '/usuarios/equipo',          label: 'Usuarios',      icon: UserCog,    roles: ['super_admin', 'logistica'] },
      { to: '/admin/mapa-clientes',      label: 'Mapa clientes', icon: Map,        roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'] },
      { to: '/admin/precios',            label: 'Precios',       icon: Tag,        roles: ['super_admin', 'logistica', 'gerente_comercial', 'comercial'] },
      { to: '/comercial/reporte-precios', label: 'Rep. precios', icon: DollarSign, roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion'] },
      { to: '/comercial/historial-precios', label: 'Hist. precios', icon: Clock,   roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'logistica', 'facturacion'] },
    ],
  },
  {
    id: 'reportes', label: 'Reportes',
    items: [
      { to: '/movimientos',       label: 'Movimientos', icon: BarChart2,  roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'] },
      { to: '/comercial/ventas',  label: 'Ventas',       icon: TrendingUp, roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion'] },
    ],
  },
]
