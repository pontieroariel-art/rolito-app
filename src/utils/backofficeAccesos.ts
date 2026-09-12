import {
  UserCog, Factory, Settings, Truck, Tag, Layers, ClipboardList, Users2, Package, LayoutDashboard,
  CalendarDays, History, Activity, Cloud, Users, Map, BarChart2, DollarSign, TrendingUp,
  Navigation, Snowflake, Wrench, FileText, Store, Landmark, ShieldCheck, Warehouse, Wallet, Ban, UserCheck, Tv,
} from 'lucide-react'
import type { NavGroup } from './navGroups'

// Accesos del panel de control del super_admin (`/admin`, 2026-09-10). Antes
// eran 37 tarjetas con descripción (BackofficeHome); ahora van compactos y
// plegados, agrupados por área, abajo del estado real. Cada link apunta a la
// pantalla en su layout de siempre (la usa gente que no es super_admin).

export interface Acceso {
  to:    string
  label: string
  icon:  React.ComponentType<{ size?: number; className?: string }>
}

export interface GrupoAccesos {
  id:      string
  titulo:  string
  accesos: Acceso[]
}

export const ACCESOS: GrupoAccesos[] = [
  {
    id: 'admin', titulo: 'Administración',
    accesos: [
      { to: '/admin/usuarios',          label: 'Usuarios & Roles',          icon: UserCog },
      { to: '/admin/general',           label: 'Ajustes generales',         icon: Settings },
      { to: '/usuarios',                label: 'Clientes (CRM)',            icon: Users },
      { to: '/admin/mapa-clientes',     label: 'Mapa de clientes',          icon: Map },
      { to: '/gerente',                 label: 'Panel de directores',       icon: LayoutDashboard },
    ],
  },
  {
    id: 'facturacion', titulo: 'Facturación',
    accesos: [
      { to: '/movimientos',               label: 'Movimientos',               icon: BarChart2 },
      { to: '/admin/comprobantes',        label: 'Comprobantes de clientes',  icon: FileText },
      { to: '/admin/recupero-facturas',   label: 'Recupero de facturas',      icon: FileText },
      { to: '/anulaciones',               label: 'Anulaciones (NC)',          icon: Ban },
    ],
  },
  {
    id: 'logistica', titulo: 'Logística',
    accesos: [
      { to: '/logistica',                label: 'Despacho',           icon: CalendarDays },
      { to: '/admin/historial-despacho', label: 'Hist. despacho',     icon: History },
      { to: '/admin/monitoreo',          label: 'Monitoreo',          icon: Activity },
      { to: '/admin/visitas',            label: 'Visitas',            icon: ClipboardList },
      { to: '/admin/incidencias',        label: 'Incidencias',        icon: ClipboardList },
      { to: '/admin/clima',              label: 'Clima',              icon: Cloud },
      { to: '/admin/flota',              label: 'Flota',              icon: Truck },
      { to: '/admin/precios',            label: 'Precios',            icon: Tag },
    ],
  },
  {
    id: 'comercial', titulo: 'Comercial',
    accesos: [
      { to: '/comercial',                 label: 'Tablero comercial',  icon: LayoutDashboard },
      { to: '/comercial/mapa',            label: 'Reparto en vivo',    icon: Navigation },
      { to: '/comercial/reporte-precios', label: 'Reporte de precios', icon: DollarSign },
      { to: '/comercial/ventas',          label: 'Ventas',             icon: TrendingUp },
    ],
  },
  {
    id: 'expedicion', titulo: 'Expedición y tesorería',
    accesos: [
      { to: '/caja/remitos',          label: 'Remitos de carga',    icon: Truck },
      { to: '/caja/ventanilla',       label: 'Ventanilla',          icon: Store },
      { to: '/caja/liquidaciones',    label: 'Liquidaciones',       icon: Wallet },
      { to: '/muelle',                label: 'Muelle',              icon: Warehouse },
      { to: '/muelle/tv',             label: 'Muelle · pantalla',   icon: Tv },
      { to: '/seguridad',             label: 'Seguridad (portón)',  icon: ShieldCheck },
      { to: '/tesoreria',             label: 'Tesorería en vivo',   icon: Landmark },
      { to: '/tesoreria/rendiciones', label: 'Rendiciones',         icon: ClipboardList },
      { to: '/tesoreria/entregas',    label: 'Entregas de caja',    icon: Wallet },
      { to: '/supervisor',            label: 'Supervisor (calle)',  icon: UserCheck },
    ],
  },
  {
    id: 'heladeras', titulo: 'Heladeras',
    accesos: [
      { to: '/heladeras',                  label: 'Heladeras',              icon: Snowflake },
      { to: '/heladeras/taller',           label: 'Taller',                 icon: Wrench },
      { to: '/heladeras/asignacion',       label: 'Asignación de equipos',  icon: Package },
      { to: '/heladeras/ranking',          label: 'Ranking de consumo',     icon: BarChart2 },
      { to: '/heladeras/consulta-service', label: 'Consulta service',       icon: ClipboardList },
      { to: '/heladeras/toma-service',     label: 'Toma de service',        icon: ClipboardList },
      { to: '/heladeras/informes',         label: 'Informes',               icon: Activity },
      { to: '/heladeras/mapa',             label: 'Mapa de heladeras',      icon: Map },
      { to: '/heladeras/modelos',          label: 'Modelos',                icon: Layers },
      { to: '/heladeras/catalogos',        label: 'Catálogos de service',   icon: ClipboardList },
      { to: '/heladeras/tecnicos',         label: 'Técnicos',               icon: Users2 },
      { to: '/heladeras/equipos',          label: 'Padrón de equipos',      icon: Package },
      { to: '/heladeras/panol',            label: 'Pañol de repuestos',     icon: Package },
    ],
  },
  {
    id: 'produccion', titulo: 'Producción',
    accesos: [
      { to: '/produccion/resumen',   label: 'Resumen',   icon: Activity },
      { to: '/produccion/listado',   label: 'Listado',   icon: ClipboardList },
      { to: '/produccion/operarios', label: 'Operarios', icon: Factory },
      { to: '/produccion/plantas',   label: 'Plantas',   icon: Factory },
    ],
  },
]

// Grupo "Ir a" del sidebar del Backoffice: la puerta a cada sistema y a los
// puestos que no tienen entrada en ningún otro menú del super_admin.
export const NAV_IR_A: NavGroup = {
  id: 'ir-a', label: 'Ir a',
  items: [
    { to: '/logistica',          label: 'Logística',   icon: LayoutDashboard, roles: ['super_admin'] },
    { to: '/heladeras',          label: 'Heladeras',   icon: Snowflake,       roles: ['super_admin'] },
    { to: '/produccion/resumen', label: 'Producción',  icon: Factory,         roles: ['super_admin'] },
    { to: '/caja/remitos',       label: 'Caja',        icon: Store,           roles: ['super_admin'] },
    { to: '/movimientos',        label: 'Facturación', icon: FileText,        roles: ['super_admin'] },
    { to: '/tesoreria',          label: 'Tesorería',   icon: Landmark,        roles: ['super_admin'] },
    { to: '/supervisor',         label: 'Supervisor',  icon: UserCheck,       roles: ['super_admin'] },
  ],
}
