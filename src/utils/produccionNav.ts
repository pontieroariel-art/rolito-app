import { NavGroup } from './navGroups'
import { UserRole } from '../types'
import { gruposDe } from '@/rutas/catalogo'

// Sidebar del encargado de producción: sale del catálogo de rutas
// (src/rutas/catalogo.ts → SIDEBARS.produccion).
//
// "Listado" (/produccion/listado) es una pantalla compartida con gerencia/
// logística/comercial: la MISMA ruta se renderiza dentro de este shell para
// encargado/super_admin (usaShellProduccion) y con el Navbar genérico para el
// resto — ver ProduccionListadoPage.
export const PRODUCCION_NAV_GROUPS: NavGroup[] = gruposDe('produccion')

// ¿Este rol ve las pantallas de producción dentro del shell del encargado
// (sidebar de ProduccionLayout)? super_admin entra igual que el encargado —
// consistente con /produccion/operarios, que ya le muestra este sidebar.
// Gerencia/logística/comercial consultan el listado con su Navbar de siempre.
export function usaShellProduccion(rol: UserRole | undefined): boolean {
  return rol === 'produccion_encargado' || rol === 'super_admin'
}
