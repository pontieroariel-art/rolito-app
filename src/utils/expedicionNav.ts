import { NavGroup } from './navGroups'
import { gruposDe } from '@/rutas/catalogo'

// Sidebar de expedición de planta (caja, más muelle/seguridad como rol
// adicional): sale del catálogo de rutas (src/rutas/catalogo.ts →
// SIDEBARS.expedicion).
export const EXPEDICION_NAV_GROUPS: NavGroup[] = gruposDe('expedicion')
