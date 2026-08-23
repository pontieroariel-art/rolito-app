import {
  LayoutDashboard, CalendarDays, History, Activity, AlertTriangle, ClipboardList,
  Truck, Cloud, Navigation, Users, Map, Tag, DollarSign, TrendingUp, Clock, BarChart2,
} from 'lucide-react'
import { NavGroup } from './navGroups'

// Basado en el NAV_LINKS por rol que tenía Navbar.tsx, con los huecos entre
// nav y allowedRoles de App.tsx ya cerrados (roles que podían entrar a una
// pantalla por URL pero nunca tuvieron el link: Reparto para super_admin/
// logistica, Rep. precios para gerente_comercial, Ventas para comercial,
// Hist. precios para gerente_comercial/comercial/logistica, Movimientos
// para gerente_general/logistica). /comercial/pedidos no tiene nav propio
// (se llega desde un link contextual en el tablero comercial).
//
// super_admin ya no tiene ítems acá salvo Flota/Precios (config compartida,
// ver plan de migración del Backoffice) — el resto de su navegación vive en
// el Backoffice (`/admin/*`, ver backofficeNav.ts). Lo que sigue en este
// archivo son pantallas operativas/de reporte de logística, comercial y
// gerencia — ya no las opera ni las mira super_admin, son cosa de cada rol.
export const LOGISTICA_NAV_GROUPS: NavGroup[] = [
  {
    id: 'operacion', label: 'Operación',
    items: [
      { to: '/comercial',           label: 'Tablero',       icon: LayoutDashboard, roles: ['comercial'] },
      { to: '/gerente',             label: 'Tablero',       icon: LayoutDashboard, roles: ['gerente_general'] },
      { to: '/logistica/resumen',   label: 'Resumen',       icon: LayoutDashboard, roles: ['logistica', 'gerente_comercial'] },
      { to: '/logistica',           label: 'Planificación', icon: CalendarDays,    roles: ['logistica', 'gerente_comercial'] },
      { to: '/admin/historial-despacho', label: 'Hist. despacho', icon: History,        roles: ['logistica', 'gerente_comercial'] },
      { to: '/admin/monitoreo',          label: 'Monitoreo',      icon: Activity,       roles: ['logistica', 'gerente_general', 'gerente_comercial'] },
      { to: '/admin/incidencias',        label: 'Incidencias',    icon: AlertTriangle,  roles: ['logistica'] },
      { to: '/admin/visitas',            label: 'Visitas',        icon: ClipboardList,  roles: ['logistica'] },
      { to: '/admin/clima',              label: 'Clima',          icon: Cloud,          roles: ['logistica', 'gerente_comercial', 'comercial'] },
      { to: '/comercial/mapa',           label: 'Reparto',        icon: Navigation,     roles: ['logistica', 'comercial'] },
    ],
  },
  {
    id: 'clientes', label: 'Clientes & Precios',
    items: [
      { to: '/usuarios',                 label: 'Clientes',      icon: Users,      roles: ['gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'] },
      { to: '/admin/mapa-clientes',      label: 'Mapa clientes', icon: Map,        roles: ['gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'] },
      { to: '/comercial/reporte-precios', label: 'Rep. precios', icon: DollarSign, roles: ['gerente_general', 'gerente_comercial', 'comercial', 'facturacion'] },
      { to: '/comercial/historial-precios', label: 'Hist. precios', icon: Clock,   roles: ['gerente_general', 'gerente_comercial', 'comercial', 'logistica', 'facturacion'] },
    ],
  },
  {
    id: 'configuracion', label: 'Configuración',
    items: [
      { to: '/admin/flota',   label: 'Flota',   icon: Truck, roles: ['super_admin', 'logistica'] },
      { to: '/admin/precios', label: 'Precios', icon: Tag,   roles: ['super_admin', 'logistica', 'gerente_comercial', 'comercial'] },
    ],
  },
  {
    id: 'reportes', label: 'Reportes',
    items: [
      { to: '/movimientos',       label: 'Movimientos', icon: BarChart2,  roles: ['gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'] },
      { to: '/comercial/ventas',  label: 'Ventas',       icon: TrendingUp, roles: ['gerente_general', 'gerente_comercial', 'comercial', 'facturacion'] },
    ],
  },
]
