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
// (2026-09-07, ampliado el 2026-09-13) Un usuario tiene UN rol (`rol`, que
// define su home) y puede tener además otros roles para cubrir otro puesto:
// Lucas es de logística, muchos días hace caja y además factura. Solo el
// super_admin los asigna, desde Usuarios → fila del staff.
//
// Las reglas de Firestore hacen la misma pregunta con hasRol() / hasAlguno();
// acá está la versión para las rutas, la nav y el picker de dominio. Todo lo
// que decide por rol tiene que pasar por tieneRol / tieneAlgunRol y nunca por
// `user.rol === 'caja'`.

/**
 * Roles FÍSICOS: se ejercen en una planta concreta, así que exigen `planta`.
 * Sin ella las reglas de expedición rechazan todo y la persona vería pantallas
 * que no funcionan. Espejado en firestore.rules → rolesExtraOk().
 */
export const ROLES_EXTRA_DE_PLANTA: readonly UserRole[] = ['caja', 'muelle', 'seguridad']

/**
 * Qué se puede otorgar como rol adicional, agrupado por área para que elegir
 * sea leer y no buscar entre dieciséis casilleros sueltos.
 *
 * Quedan afuera dos: `super_admin`, que no se regala, y `cliente`, que es otra
 * población con su propio registro y su propio login. La misma lista está en
 * firestore.rules → rolesExtraOk(); si se toca una, se toca la otra.
 */
export const GRUPOS_ROLES_EXTRA: ReadonlyArray<{ area: string; roles: readonly UserRole[] }> = [
  { area: 'Mostrador y planta', roles: ['caja', 'muelle', 'seguridad'] },
  { area: 'Logística',          roles: ['logistica', 'chofer'] },
  { area: 'Producción',         roles: ['produccion_encargado', 'produccion_hielo'] },
  { area: 'Tesorería',          roles: ['tesoreria'] },
  { area: 'Comercial',          roles: ['comercial', 'facturacion', 'supervisor'] },
  { area: 'Heladeras',          roles: ['heladeras', 'heladeras_encargado', 'tecnico'] },
  { area: 'Gerencia',           roles: ['gerente_general', 'gerente_comercial'] },
]

export const ROLES_EXTRA_DISPONIBLES: readonly UserRole[] = GRUPOS_ROLES_EXTRA.flatMap((g) => [...g.roles])

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

/** ¿Alguno de los roles adicionales se ejerce en una planta? */
export function pidePlanta(rolesExtra: UserRole[] | undefined): boolean {
  return (rolesExtra ?? []).some((r) => ROLES_EXTRA_DE_PLANTA.includes(r))
}

/**
 * La planta es obligatoria SOLO para los roles físicos (caja / muelle /
 * seguridad): sin ella las reglas de expedición rechazan todo. Los de oficina
 * (facturación, comercial, tesorería…) no tienen planta y no deben pedirla.
 */
export function rolesExtraValidos(rolesExtra: UserRole[] | undefined, planta: PlantaId | undefined): boolean {
  return !pidePlanta(rolesExtra) || !!planta
}
