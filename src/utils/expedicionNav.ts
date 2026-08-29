import { ClipboardList } from 'lucide-react'
import { NavGroup } from './navGroups'

// Roles de cada ítem = exactamente el allowedRoles de su <Route> en App.tsx
// (misma regla que logisticaNav/heladerasNav/produccionNav).
//
// Fase 1: solo remitos de carga. Ventanilla y Liquidaciones se suman acá en
// sus fases (ver plan del módulo expedición).
export const EXPEDICION_NAV_GROUPS: NavGroup[] = [
  {
    id: 'expedicion', label: 'Expedición',
    items: [
      { to: '/caja/remitos', label: 'Remitos de carga', icon: ClipboardList, roles: ['caja', 'super_admin'] },
    ],
  },
]
