import { UserRole } from '../types'

export type Sistema = 'logistica' | 'heladeras'

// Todos los roles quedan mapeados (Record completo, no Partial) para que TS
// obligue a cubrir roles nuevos. 'logistica' acá es "todo lo que no es
// heladeras" — para cliente/chofer/facturacion/gerente_general no implica que
// sean personal de logística, solo que no tienen picker (un solo sistema).
export const ROLE_SISTEMAS: Record<UserRole, Sistema[]> = {
  super_admin:         ['logistica', 'heladeras'],
  gerente_comercial:   ['logistica', 'heladeras'],
  comercial:           ['logistica', 'heladeras'],
  gerente_general:     ['logistica'],
  logistica:           ['logistica'],
  facturacion:         ['logistica'],
  chofer:              ['logistica'],
  cliente:             ['logistica'],
  heladeras:           ['heladeras'],
  heladeras_encargado: ['heladeras'],
  tecnico:             ['heladeras'],
}

// Home por sistema, solo para los roles con más de un sistema (los demás ya
// tienen su home fijo en ROLE_HOME de Landing.tsx).
export const MULTI_SISTEMA_HOME: Partial<Record<UserRole, Record<Sistema, string>>> = {
  super_admin:       { logistica: '/admin',     heladeras: '/heladeras' },
  gerente_comercial: { logistica: '/logistica', heladeras: '/heladeras' },
  comercial:         { logistica: '/comercial', heladeras: '/heladeras' },
}

export const SISTEMA_LABELS: Record<Sistema, string> = {
  logistica: 'Logística',
  heladeras: 'Heladeras',
}
