import {
  LayoutDashboard, CalendarDays, History, Activity, AlertTriangle, ClipboardList,
  Truck, Cloud, Navigation, Users, Map, Tag, DollarSign, TrendingUp, Clock, BarChart2, FileText,
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
// super_admin vuelve a tener el menú completo acá (2026-08-27, ver
// sistemas.ts) — mismo criterio de siempre: los roles de cada ítem son
// exactamente el allowedRoles de su <Route> en App.tsx.
export const LOGISTICA_NAV_GROUPS: NavGroup[] = [
  {
    id: 'operacion', label: 'Operación',
    items: [
      { to: '/comercial',           label: 'Tablero',       icon: LayoutDashboard, roles: ['super_admin', 'comercial'] },
      { to: '/gerente',             label: 'Tablero',       icon: LayoutDashboard, roles: ['gerente_general'] },
      { to: '/logistica/resumen',   label: 'Resumen',       icon: LayoutDashboard, roles: ['super_admin', 'logistica', 'gerente_comercial'] },
      { to: '/logistica',           label: 'Planificación', icon: CalendarDays,    roles: ['super_admin', 'logistica', 'gerente_comercial'] },
      { to: '/admin/historial-despacho', label: 'Hist. despacho', icon: History,        roles: ['super_admin', 'logistica', 'gerente_comercial'] },
      { to: '/admin/monitoreo',          label: 'Monitoreo',      icon: Activity,       roles: ['super_admin', 'logistica', 'gerente_general', 'gerente_comercial'] },
      { to: '/admin/incidencias',        label: 'Incidencias',    icon: AlertTriangle,  roles: ['super_admin', 'logistica'] },
      { to: '/admin/visitas',            label: 'Visitas',        icon: ClipboardList,  roles: ['super_admin', 'logistica'] },
      { to: '/admin/clima',              label: 'Clima',          icon: Cloud,          roles: ['super_admin', 'logistica', 'gerente_comercial', 'comercial'] },
      { to: '/comercial/mapa',           label: 'Reparto',        icon: Navigation,     roles: ['super_admin', 'logistica', 'comercial'] },
    ],
  },
  {
    id: 'clientes', label: 'Clientes & Precios',
    items: [
      { to: '/usuarios',                 label: 'Clientes',      icon: Users,      roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'] },
      { to: '/admin/mapa-clientes',      label: 'Mapa clientes', icon: Map,        roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'] },
      { to: '/comercial/reporte-precios', label: 'Rep. precios', icon: DollarSign, roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion'] },
      { to: '/comercial/historial-precios', label: 'Hist. precios', icon: Clock,   roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'logistica', 'facturacion'] },
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
      { to: '/movimientos',       label: 'Movimientos', icon: BarChart2,  roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'] },
      { to: '/comercial/ventas',  label: 'Ventas',       icon: TrendingUp, roles: ['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion'] },
    ],
  },
  // Campaña de recupero de las facturas viejas de Tango. Cuando termine, este
  // grupo entero se borra junto con la pantalla y su ruta.
  {
    id: 'facturacion', label: 'Facturación',
    items: [
      { to: '/admin/recupero-facturas', label: 'Recupero', icon: FileText, roles: ['super_admin', 'facturacion'] },
    ],
  },
]
