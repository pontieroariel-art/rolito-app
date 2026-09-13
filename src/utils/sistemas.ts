import { UserProfile, UserRole, Sistema } from '../types'
import { rolesDe } from './roles'
import { homeDeSistema as homeDeSistemaCatalogo } from '@/rutas/catalogo'

export type { Sistema }

/** Los seis dominios, en el orden del selector de la cabecera y del picker. */
export const SISTEMAS: Sistema[] = ['logistica', 'produccion', 'tesoreria', 'comercial', 'heladeras', 'administracion']

/** Nombres cortos: entran los seis en la cabecera hasta 1024 px de ancho. */
export const SISTEMA_LABELS: Record<Sistema, string> = {
  logistica:      'Logística',
  produccion:     'Producción',
  tesoreria:      'Tesorería',
  comercial:      'Comercial',
  heladeras:      'Heladeras',
  administracion: 'Admin',
}

export const SISTEMA_DESCRIPCIONES: Record<Sistema, string> = {
  logistica:      'Despacho, ruteo, flota, muelle y salida de camiones',
  produccion:     'Hielo en planta, máquinas, operarios y stock',
  tesoreria:      'Ventanilla, cobranzas, liquidaciones, cierres y arqueos',
  comercial:      'Clientes, precios, visitas, comprobantes y supervisores',
  heladeras:      'Taller, service, equipos y pañol',
  administracion: 'Panel de control, usuarios y permisos, ajustes, gerencia',
}

// Dominios de cada rol. Record completo para que TS obligue a cubrir roles
// nuevos. Vacío = rol de calle o de planta sin shell de escritorio (usa el
// Navbar o su pantalla propia: chofer, técnico, supervisor, muelle, seguridad,
// operario, cliente). Qué ve cada rol DENTRO de un dominio lo decide el
// catálogo de rutas (src/rutas/catalogo.ts → SIDEBARS, por los roles de cada
// ruta); `catalogo.test.ts` verifica que ningún dominio quede vacío para un rol
// que lo tiene y que cada rol llegue por algún menú a todo lo que puede abrir.
//
// El cajero tiene dos dominios porque hace dos circuitos distintos: la salida
// del camión (remito de carga, en Logística) y la plata (ventanilla, cobranzas
// y su cierre, en Tesorería). Cambia de uno a otro desde la cabecera.
export const ROLE_SISTEMAS: Record<UserRole, Sistema[]> = {
  super_admin:          ['logistica', 'produccion', 'tesoreria', 'comercial', 'heladeras', 'administracion'],
  gerente_general:      ['administracion', 'logistica', 'tesoreria', 'comercial'],
  gerente_comercial:    ['logistica', 'comercial', 'heladeras'],
  comercial:            ['comercial', 'heladeras'],
  logistica:            ['logistica', 'comercial'],
  facturacion:          ['comercial'],
  chofer:               [],
  cliente:              [],
  heladeras:            ['heladeras'],
  heladeras_encargado:  ['heladeras'],
  tecnico:              [],
  produccion_hielo:     [],
  produccion_encargado: ['produccion'],
  caja:                 ['logistica', 'tesoreria'],
  muelle:               [],
  seguridad:            [],
  supervisor:           [],
  tesoreria:            ['tesoreria'],
}

// Home por rol: adónde va el usuario tras loguearse. Fuente ÚNICA (antes
// estaba duplicado en Landing.tsx y LoginEmpresa.tsx). Los roles con varios
// dominios entran a su home de siempre y cambian de dominio desde la cabecera
// del shell; solo super_admin pasa por el picker /sistema. Record completo
// para que TS obligue a cubrir cada rol nuevo.
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

/**
 * `sistemasPermitidos` guardado antes de un cambio de dominios puede traer
 * nombres viejos. Se traducen en lectura, así nadie pierde accesos ni hay que
 * migrar documentos:
 *   · antes de la fase 2 existían 'produccion' y 'expedicion' sueltos;
 *   · la fase 2 los metió en 'logistica' y llamó 'admin' a Administración;
 *   · el corte a seis dominios (2026-09-12) devolvió 'produccion' como dominio
 *     propio, mandó la plata de 'expedicion' a 'tesoreria' y renombró 'admin'.
 */
function compat(s: string): Sistema | null {
  if (s === 'expedicion') return 'tesoreria'
  if (s === 'admin')      return 'administracion'
  return (SISTEMAS as string[]).includes(s) ? (s as Sistema) : null
}

// Techo real: lo que permite el rol principal MÁS lo de los roles adicionales
// (logística + caja → logística). Ver src/utils/roles.ts. En el orden de SISTEMAS.
export function techoSistemasDe(user: Pick<UserProfile, 'rol' | 'rolesExtra'>): Sistema[] {
  const set = new Set<Sistema>()
  for (const rol of rolesDe(user)) for (const s of ROLE_SISTEMAS[rol]) set.add(s)
  return SISTEMAS.filter((s) => set.has(s))
}

// Dominios efectivos de un usuario: su `sistemasPermitidos` (si el admin lo
// recortó desde Usuarios → Permisos) filtrado contra el techo real del rol —
// nunca devuelve algo que el rol no permita, aunque el campo haya quedado
// desactualizado por un cambio de rol posterior.
export function sistemasDeUsuario(user: Pick<UserProfile, 'rol' | 'sistemasPermitidos' | 'rolesExtra'>): Sistema[] {
  const techo = techoSistemasDe(user)
  if (!user.sistemasPermitidos) return techo
  const permitidos = new Set(user.sistemasPermitidos.map(compat).filter((s): s is Sistema => s !== null))
  return techo.filter((s) => permitidos.has(s))
}

/** Adónde entra este usuario en un dominio (catálogo → HOME_SISTEMA). */
export function homeDeSistema(sistema: Sistema, user: Pick<UserProfile, 'rol' | 'rolesExtra'>): string {
  return homeDeSistemaCatalogo(sistema, user)
}

// Home de cada dominio disponible, solo para quien tiene más de uno (el
// picker /sistema); con uno solo devuelve undefined y el picker no aplica.
export function homesDeUsuario(user: Pick<UserProfile, 'rol' | 'sistemasPermitidos' | 'rolesExtra'>): Partial<Record<Sistema, string>> | undefined {
  const sistemas = sistemasDeUsuario(user)
  if (sistemas.length <= 1) return undefined
  const homes: Partial<Record<Sistema, string>> = {}
  for (const s of sistemas) homes[s] = homeDeSistema(s, user)
  return homes
}
