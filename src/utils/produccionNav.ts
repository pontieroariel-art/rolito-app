import { Factory } from 'lucide-react'
import { NavGroup } from './navGroups'

// Roles de cada ítem = exactamente el allowedRoles de su <Route> en App.tsx.
// Arranca chico a propósito (ver plan de migración del Backoffice, rol
// produccion_encargado) — se va a ir sumando acá a medida que se agreguen
// pantallas de gestión de planta.
//
// "Listado" (/produccion/listado) queda afuera a propósito: es una pantalla
// compartida con gerencia/logística que tiene su propio Navbar genérico, no
// este layout — meterla en este sidebar sacaría al encargado de este shell
// en cada click. Se linkea desde adentro de las páginas, no desde acá.
export const PRODUCCION_NAV_GROUPS: NavGroup[] = [
  {
    id: 'produccion', label: 'Producción',
    items: [
      { to: '/produccion/operarios', label: 'Operarios', icon: Factory, roles: ['produccion_encargado', 'super_admin'] },
    ],
  },
]
