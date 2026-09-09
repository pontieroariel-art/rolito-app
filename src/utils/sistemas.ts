import { UserProfile, UserRole, Sistema } from '../types'
import { rolesDe } from './roles'

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
  // Tesorería (2026-09-09): panel propio (/tesoreria) sobre el circuito de
  // expedición — ve en vivo ventas y cobranzas y valida las rendiciones.
  tesoreria:           ['expedicion'],
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
  tesoreria:            '/tesoreria',
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
export function sistemasDeUsuario(user: Pick<UserProfile, 'rol' | 'sistemasPermitidos' | 'rolesExtra'>): Sistema[] {
  const techo = techoSistemasDe(user)
  return (user.sistemasPermitidos ?? techo).filter((s) => techo.includes(s))
}

// Techo real: lo que permite el rol principal MÁS lo de los roles adicionales
// (logística + caja → logística y expedición). Ver src/utils/roles.ts.
export function techoSistemasDe(user: Pick<UserProfile, 'rol' | 'rolesExtra'>): Sistema[] {
  const out: Sistema[] = []
  for (const rol of rolesDe(user)) for (const s of ROLE_SISTEMAS[rol]) if (!out.includes(s)) out.push(s)
  return out
}

// Adónde entra el usuario en cada sistema. Los roles multi-sistema tienen su
// tabla (MULTI_SISTEMA_HOME); para un sistema que viene de un rol adicional se
// usa el home de ese rol (caja → /caja). Solo tiene sentido con más de un
// sistema disponible; con uno solo devuelve undefined y el picker no aplica.
export function homesDeUsuario(user: Pick<UserProfile, 'rol' | 'sistemasPermitidos' | 'rolesExtra'>): Partial<Record<Sistema, string>> | undefined {
  const sistemas = sistemasDeUsuario(user)
  if (sistemas.length <= 1) return undefined
  const homes: Partial<Record<Sistema, string>> = {}
  for (const s of sistemas) {
    const propio = MULTI_SISTEMA_HOME[user.rol]?.[s]
    const rolExtra = rolesDe(user).find((r) => ROLE_SISTEMAS[r].includes(s))
    const home = propio ?? (rolExtra ? ROLE_HOME[rolExtra] : undefined)
    if (home) homes[s] = home
  }
  return homes
}
