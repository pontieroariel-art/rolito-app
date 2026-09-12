import { NavGroup } from './navGroups'
import { gruposDe } from '@/rutas/catalogo'

// Sidebar de tesorería (2026-09-09): sale del catálogo de rutas
// (src/rutas/catalogo.ts → SIDEBARS.tesoreria).
export const TESORERIA_NAV_GROUPS: NavGroup[] = gruposDe('tesoreria')
