import type { NavGroup } from './navGroups'
import { accesosDelPanel, grupoIrA } from '@/rutas/catalogo'

// Accesos del panel de control del super_admin (`/admin`, 2026-09-10). Antes
// eran 37 tarjetas con descripción (BackofficeHome); ahora van compactos y
// plegados, agrupados por área, abajo del estado real. Cada link apunta a la
// pantalla en su layout de siempre (la usa gente que no es super_admin).
// Desde la fase 1 del reordenamiento (2026-09-12) la lista, los nombres y los
// íconos salen del catálogo de rutas (src/rutas/catalogo.ts → PANEL).

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

export const ACCESOS: GrupoAccesos[] = accesosDelPanel()

// Grupo "Ir a" del sidebar del Backoffice: la puerta a cada sistema y a los
// puestos que no tienen entrada en ningún otro menú del super_admin
// (src/rutas/catalogo.ts → IR_A).
export const NAV_IR_A: NavGroup = grupoIrA()
