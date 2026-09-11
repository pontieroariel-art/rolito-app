import type { PlantaId, UserProfile, UserRole } from '@/types'

// ── Catálogo de roles ─────────────────────────────────────────────────────────
// Fuente única (2026-09-10): antes la lista vivía copiada en Navbar
// (ROLE_LABELS), en user-management/shared.tsx (ALL_ROLES / STAFF_ROLES) y en
// userService.getStaffUsers, y se desincronizaban al agregar un rol (pasó con
// supervisor). `Record<UserRole, …>` obliga a TypeScript a exigir los 18.

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:          'Super Admin',
  gerente_general:      'Gte. General',
  gerente_comercial:    'Gte. Comercial',
  comercial:            'Comercial',
  logistica:            'Logística',
  facturacion:          'Facturación',
  tesoreria:            'Tesorería',
  chofer:               'Chofer',
  cliente:              'Cliente',
  heladeras:            'Heladeras',
  heladeras_encargado:  'Enc. Heladeras',
  tecnico:              'Técnico',
  produccion_hielo:     'Producción',
  produccion_encargado: 'Enc. Producción',
  caja:                 'Caja',
  muelle:               'Muelle',
  seguridad:            'Seguridad',
  supervisor:           'Supervisor',
}

/** Los 18 roles, en el orden en que se muestran en combos y filtros. */
export const ROLES: readonly UserRole[] = Object.keys(ROLE_LABELS) as UserRole[]

/**
 * Staff que se administra desde Usuarios: todo menos clientes y operarios de
 * producción (los operarios tienen su propia pantalla, /produccion/operarios,
 * con legajo y PIN).
 */
export const STAFF_ROLES: readonly UserRole[] = ROLES.filter((r) => r !== 'cliente' && r !== 'produccion_hielo')

// ── Roles adicionales ─────────────────────────────────────────────────────────
// (2026-09-07) Un usuario tiene UN rol (`rol`, que define su sistema y su
// home) y puede tener además roles de expedición para cubrir el mostrador:
// Lucas es de logística y muchos días hace caja. Solo el super_admin los
// asigna (Usuarios → fila del staff), y van con la planta, porque caja /
// muelle / seguridad operan en SU planta.
//
// Las reglas de Firestore hacen la misma pregunta con hasRol(); acá está la
// versión para las rutas, la nav y el picker de sistema. Todo lo que decide
// por rol en el módulo expedición tiene que pasar por tieneRol / tieneAlgunRol
// y no por `user.rol === 'caja'`.

export const ROLES_EXTRA_DISPONIBLES = ['caja', 'muelle', 'seguridad'] as const
export type RolExtra = (typeof ROLES_EXTRA_DISPONIBLES)[number]

type ConRoles = Pick<UserProfile, 'rol'> & { rolesExtra?: UserRole[] }

/** Rol principal + adicionales, sin repetidos. */
export function rolesDe(user: ConRoles): UserRole[] {
  const extra = (user.rolesExtra ?? []).filter((r) => r !== user.rol)
  return [user.rol, ...extra]
}

export function tieneRol(user: ConRoles | null | undefined, rol: UserRole): boolean {
  return !!user && rolesDe(user).includes(rol)
}

export function tieneAlgunRol(user: ConRoles | null | undefined, roles: readonly UserRole[]): boolean {
  return !!user && rolesDe(user).some((r) => roles.includes(r))
}

/** Los roles adicionales necesitan planta: sin ella las reglas rechazan todo. */
export function rolesExtraValidos(rolesExtra: UserRole[] | undefined, planta: PlantaId | undefined): boolean {
  return !rolesExtra || rolesExtra.length === 0 || !!planta
}
