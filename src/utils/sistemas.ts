import { UserProfile, UserRole, Sistema } from '../types'

export type { Sistema }

// Todos los roles quedan mapeados (Record completo, no Partial) para que TS
// obligue a cubrir roles nuevos. 'logistica' acá es "todo lo que no es
// heladeras" — para cliente/chofer/facturacion/gerente_general no implica que
// sean personal de logística, solo que no tienen picker (un solo sistema).
//
// super_admin vuelve a operar los 3 sistemas como antes de la migración del
// Backoffice (2026-08-27, pedido de Ariel: quiere navegar la app igual que
// el resto del staff, no un panel administrativo aparte). El loop de
// redirects que esto causaba (/heladeras → / → /sistema → /heladeras) ya no
// pasa porque ahora super_admin está en el allowedRoles de esas rutas en
// App.tsx — si se vuelve a sacar de una ruta ahí, hay que sacarlo de acá también.
export const ROLE_SISTEMAS: Record<UserRole, Sistema[]> = {
  super_admin:         ['logistica', 'heladeras', 'produccion'],
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
  produccion_hielo:    ['produccion'],
  produccion_encargado: ['produccion'],
}

// Home por sistema, solo para los roles con más de un sistema (los demás ya
// tienen su home fijo en ROLE_HOME de Landing.tsx).
// 'produccion' nunca aparece realmente en el picker de estos roles (su
// ROLE_SISTEMAS no lo incluye), pero el tipo interno es un Record<Sistema,
// string> completo — apunta al listado de gerencia por si a futuro se les
// suma acceso.
export const MULTI_SISTEMA_HOME: Partial<Record<UserRole, Record<Sistema, string>>> = {
  gerente_comercial: { logistica: '/logistica', heladeras: '/heladeras', produccion: '/produccion/listado' },
  comercial:         { logistica: '/comercial', heladeras: '/heladeras', produccion: '/produccion/listado' },
  super_admin:       { logistica: '/logistica', heladeras: '/heladeras', produccion: '/produccion/listado' },
}

export const SISTEMA_LABELS: Record<Sistema, string> = {
  logistica:  'Logística',
  heladeras:  'Heladeras',
  produccion: 'Producción',
}

// Sistemas efectivos de un usuario: su `sistemasPermitidos` (si el admin lo
// recortó desde Usuarios → Permisos) filtrado contra el techo real del rol —
// nunca devuelve algo que el rol no permita, aunque el campo haya quedado
// desactualizado por un cambio de rol posterior.
export function sistemasDeUsuario(user: Pick<UserProfile, 'rol' | 'sistemasPermitidos'>): Sistema[] {
  const techo = ROLE_SISTEMAS[user.rol]
  return (user.sistemasPermitidos ?? techo).filter((s) => techo.includes(s))
}
