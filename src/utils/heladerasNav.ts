import { NavGroup } from './navGroups'
import { gruposDe } from '@/rutas/catalogo'

// Sidebar del sistema heladeras: sale del catálogo de rutas
// (src/rutas/catalogo.ts → SIDEBARS.heladeras). Roles = los de cada ruta.
export const HELADERAS_NAV_GROUPS: NavGroup[] = gruposDe('heladeras')
