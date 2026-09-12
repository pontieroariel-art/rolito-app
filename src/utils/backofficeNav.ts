import { NavGroup } from './navGroups'
import { gruposDe } from '@/rutas/catalogo'
import { NAV_IR_A } from './backofficeAccesos'

// Navegación del Backoffice (`/admin/*`, BackofficeLayout) — exclusivo
// super_admin. Acá entran solo las pantallas que YA son 100% privativas de
// super_admin (no las que además usa un rol operativo a diario — esas se
// quedan en su layout de siempre y se linkean desde los accesos del panel de
// control). El grupo "Ir a" (2026-09-10) es la puerta a cada sistema y a los
// puestos (caja, tesorería, supervisor) que no tenían entrada en ningún menú.
// Todo sale del catálogo de rutas (src/rutas/catalogo.ts).
export const BACKOFFICE_NAV_GROUPS: NavGroup[] = [...gruposDe('backoffice'), NAV_IR_A]
