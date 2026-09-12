import { NavGroup } from './navGroups'
import { gruposDe } from '@/rutas/catalogo'

// Sidebar del sistema logística / oficina. Desde la fase 1 del reordenamiento
// (2026-09-12) el contenido sale del catálogo de rutas (src/rutas/catalogo.ts
// → SIDEBARS.logistica): nombres, íconos y roles son los de cada ruta, así el
// sidebar nunca ofrece un link al que ProtectedRoute le va a negar el paso.
// /comercial/pedidos no tiene nav propio (se llega desde el tablero comercial).
export const LOGISTICA_NAV_GROUPS: NavGroup[] = gruposDe('logistica')
