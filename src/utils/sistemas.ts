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
  super_admin:         ['logistica', 'heladeras', 'produccion', 'expedicion'],
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
  caja:                ['expedicion'],
  muelle:              ['expedicion'],
  seguridad:           ['expedicion'],
  supervisor:          ['expedicion'],
}

// Home por rol: adónde va el usuario tras loguearse (los multi-sistema pasan
// primero por el picker /sistema). Fuente ÚNICA — antes estaba duplicado en
// Landing.tsx y LoginEmpresa.tsx y ya había divergido: a LoginEmpresa le
// faltaban heladeras/heladeras_encargado/tecnico/produccion_hielo/
// produccion_encargado, así que esos roles, al entrar por /empresa, caían al
// fallback en vez de su home. Record completo para que TS obligue a cubrir cada
// rol nuevo (auditoría 2026-08-29, H12).
export const ROLE_HOME: Record<UserRole, string> = {
  super_admin:          '/sistema',
  logistica:            '/logistica',
  comercial:            '/comercial',
  gerente_comercial:    '/logistica',
  gerente_general:      '/gerente',
  facturacion:          '/movimientos',
  chofer:               '/chofer',
  cliente:              '/dashboard',
  heladeras:            '/heladeras',
  heladeras_encargado:  '/heladeras',
  tecnico:              '/tecnico',
  produccion_hielo:     '/produccion',
  produccion_encargado: '/produccion/resumen',
  caja:                 '/caja',
  muelle:               '/muelle',
  seguridad:            '/seguridad',
  supervisor:           '/supervisor',
}

// Home por sistema, solo para los roles con más de un sistema (los demás ya
// tienen su home fijo en ROLE_HOME, arriba).
// 'produccion' nunca aparece realmente en el picker de estos roles (su
// ROLE_SISTEMAS no lo incluye), pero el tipo interno es un Record<Sistema,
// string> completo — apunta al listado de gerencia por si a futuro se les
// suma acceso.
export const MULTI_SISTEMA_HOME: Partial<Record<UserRole, Record<Sistema, string>>> = {
  gerente_comercial: { logistica: '/logistica', heladeras: '/heladeras', produccion: '/produccion/listado', expedicion: '/caja/remitos' },
  comercial:         { logistica: '/comercial', heladeras: '/heladeras', produccion: '/produccion/listado', expedicion: '/caja/remitos' },
  super_admin:       { logistica: '/logistica', heladeras: '/heladeras', produccion: '/produccion/resumen', expedicion: '/caja/remitos' },
}

export const SISTEMA_LABELS: Record<Sistema, string> = {
  logistica:  'Logística',
  heladeras:  'Heladeras',
  produccion: 'Producción',
  expedicion: 'Expedición',
}

// Sistemas efectivos de un usuario: su `sistemasPermitidos` (si el admin lo
// recortó desde Usuarios → Permisos) filtrado contra el techo real del rol —
// nunca devuelve algo que el rol no permita, aunque el campo haya quedado
// desactualizado por un cambio de rol posterior.
export function sistemasDeUsuario(user: Pick<UserProfile, 'rol' | 'sistemasPermitidos'>): Sistema[] {
  const techo = ROLE_SISTEMAS[user.rol]
  return (user.sistemasPermitidos ?? techo).filter((s) => techo.includes(s))
}
