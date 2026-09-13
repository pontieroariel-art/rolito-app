import type { LucideIcon } from 'lucide-react'
import {
  Activity, AlertTriangle, Ban, BarChart2, CalendarDays, ClipboardList, Cloud, DollarSign, Factory, FileText, Files,
  Gauge, HandCoins, History, Home, Landmark, LayoutDashboard, Layers, Map as MapIcon, Navigation, Package, Plus, Scale, Search,
  Settings, ShieldCheck, ShoppingCart, Snowflake, Tag, TrendingUp, Truck, Tv, UserCheck, UserCircle, UserCog,
  Users, Wallet, Warehouse, Wrench,
} from 'lucide-react'
import type { Sistema, UserProfile, UserRole } from '@/types'
import { tieneAlgunRol } from '@/utils/roles'

/**
 * CATÁLOGO MAESTRO DE RUTAS (fases 1 y 2 del reordenamiento, 2026-09-12).
 *
 * Única fuente de verdad de la navegación: qué pantallas hay, quién puede
 * entrar (los `allowedRoles` de cada <ProtectedRoute> en App.tsx salen de
 * acá vía `rolesDe`), con qué nombre e ícono se muestran y en qué menús
 * aparecen: los sidebars de los CUATRO DOMINIOS de escritorio (Logística,
 * Heladeras, Comercial, Administración — `SIDEBARS`, los dibuja
 * DominioLayout), el Navbar de los roles de calle/planta (`NAVBAR`) y los
 * accesos del panel de control (`PANEL`).
 *
 * Reglas:
 *  - Un path, una entrada, un `label` canónico. Los menús no inventan nombres.
 *  - `roles: []` = ruta pública. `requiereAuth` = cualquier usuario logueado.
 *  - `menuGroup` = grupo principal de la pantalla en su dominio; una pantalla
 *    puede además estar listada en otro dominio (p. ej. Movimientos vive en
 *    Logística › Operaciones y también en Comercial › Facturación).
 *  - `deepLink` = detalle / impresión / kiosco / alias: no va en menús.
 *  - `externa` = la URL está impresa o viaja por push / mail / QR: no se
 *    renombra nunca sin migrar lo que la apunta.
 *  - El ORDEN de cada menú lo dan las listas de abajo, no el catálogo.
 *
 * `src/rutas/catalogo.test.ts` verifica catálogo ↔ App.tsx, roles válidos,
 * menús sin rutas sin ícono, que cada rol llegue por algún menú a todo lo que
 * puede abrir, y que ningún dominio quede vacío para un rol que lo tiene.
 */

/**
 * A qué unidad de negocio pertenece la pantalla. Son los seis dominios más
 * `portal`, que es lo del cliente y lo público (no tiene shell). El dominio
 * manda cuando se llega a una pantalla que no está en ningún menú: es el que
 * queda marcado en la cabecera.
 */
export type Dominio = Sistema | 'portal'

export type MenuGroup =
  | 'despacho' | 'flota' | 'expedicion'
  | 'produccion' | 'configuracion'
  | 'caja' | 'tesoreria'
  | 'tablero' | 'clientes' | 'precios' | 'facturacion' | 'supervisores'
  | 'taller' | 'service' | 'stock' | 'reportes'
  | 'sistema' | 'gerencia'

export interface RutaConfig {
  path: string
  /** Nombre canónico de la pantalla, el mismo en todos los menús. */
  label: string
  icon?: LucideIcon
  dominio: Dominio
  /** Roles autorizados: lo que exige <ProtectedRoute>. Vacío = pública. */
  roles: UserRole[]
  /** Grupo principal dentro del sidebar de su dominio. */
  menuGroup?: MenuGroup
  /** Cualquier usuario autenticado y activo, sin lista de roles. */
  requiereAuth?: boolean
  /** Detalle / impresión / kiosco / alias: se llega desde otra pantalla, un QR o una push. */
  deepLink?: boolean
  /** La URL está impresa o viaja por push / mail / QR: no se renombra. */
  externa?: boolean
  /**
   * Roles que ven el ítem en los menús cuando NO son los de la ruta. Hoy solo
   * /muelle y /seguridad: en Planta & Expedición se muestran al cajero con
   * ese rol adicional, no al super_admin (que los tiene en el panel).
   */
  rolesMenu?: UserRole[]
}

const R = (path: string, label: string, dominio: Dominio, roles: UserRole[], extra: Partial<RutaConfig> = {}): RutaConfig =>
  ({ path, label, dominio, roles, ...extra })

// Listas de roles que se repiten en App.tsx, en el mismo orden que allá.
const OFICINA_CLIENTES: UserRole[] = ['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion', 'logistica']
const REPORTES: UserRole[] = ['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion']
const LOGISTICA_OPERATIVA: UserRole[] = ['super_admin', 'logistica', 'gerente_comercial']
const HELADERAS_MAESTROS: UserRole[] = ['heladeras_encargado', 'super_admin', 'gerente_comercial']
const HELADERAS_SERVICE: UserRole[] = ['super_admin', 'heladeras_encargado', 'gerente_comercial']
const HELADERAS_REPORTES: UserRole[] = ['heladeras_encargado', 'gerente_comercial', 'gerente_general', 'super_admin']
const PRODUCCION_ENCARGADO: UserRole[] = ['produccion_encargado', 'super_admin']
const PALLET: UserRole[] = ['super_admin', 'produccion_hielo', 'produccion_encargado', 'gerente_general', 'gerente_comercial', 'comercial', 'logistica']
const CAJA: UserRole[] = ['caja', 'super_admin']
const CAJA_HISTORIAL: UserRole[] = ['caja', 'super_admin', 'gerente_general']
const TESORERIA: UserRole[] = ['tesoreria', 'super_admin', 'gerente_general']
const SUPERVISOR: UserRole[] = ['supervisor', 'super_admin']

export const CATALOGO: RutaConfig[] = [
  // ── Público / accesos ─────────────────────────────────────────────────────
  R('/',                     'Inicio',                        'portal',    []),
  R('/clientes',             'Ingreso de clientes',           'portal',    []),
  R('/empresa',              'Ingreso del equipo',            'administracion',     []),
  R('/choferes',             'Ingreso de choferes',           'logistica', []),
  R('/tecnicos',             'Ingreso de técnicos',           'heladeras', []),
  R('/produccion-torcuato',  'Ingreso producción Don Torcuato', 'produccion', []),
  R('/produccion-merlo',     'Ingreso producción Merlo',      'produccion', []),
  R('/planta',               'Ingreso de planta (alias viejo)', 'produccion', [], { deepLink: true }),
  R('/login',                'Ingreso (alias viejo)',         'portal',    [], { deepLink: true }),
  R('/register',             'Registro de cliente',           'portal',    []),
  R('/forgot-password',      'Recuperar contraseña',          'portal',    []),
  R('/pendiente',            'Cuenta pendiente de aprobación', 'portal',   []),
  R('/calculadora-rolito',   'Calculadora de hielo',          'comercial', []),
  R('/turnos/:plantaId',     'Turnos de ventanilla',          'tesoreria', [], { deepLink: true, externa: true }),
  R('/sistema',              'Elegir dominio',                'administracion',     [], { requiereAuth: true, deepLink: true }),

  // ── Portal del cliente ────────────────────────────────────────────────────
  R('/sucursal',       'Elegir sucursal', 'portal', ['cliente'], { deepLink: true }),
  R('/dashboard',      'Inicio',          'portal', ['cliente'], { icon: Home }),
  R('/nuevo-pedido',   'Nuevo pedido',    'portal', ['cliente'], { icon: Plus }),
  R('/historial',      'Historial',       'portal', ['cliente'], { icon: History }),
  R('/mis-heladeras',  'Mis heladeras',   'portal', ['cliente'], { icon: Snowflake }),
  R('/perfil',         'Mi perfil',       'portal', ['cliente'], { icon: UserCircle }),

  // ── Logística: despacho y rutas ───────────────────────────────────────────
  R('/logistica/resumen',        'Resumen',          'logistica', LOGISTICA_OPERATIVA, { icon: LayoutDashboard, menuGroup: 'despacho' }),
  R('/logistica',                'Planificación',    'logistica', LOGISTICA_OPERATIVA, { icon: CalendarDays, menuGroup: 'despacho' }),
  R('/admin/planificacion',      'Planificación (alias viejo)', 'logistica', LOGISTICA_OPERATIVA, { deepLink: true }),
  R('/admin/monitoreo',          'Monitoreo',        'logistica', ['super_admin', 'logistica', 'gerente_general', 'gerente_comercial'], { icon: Activity, menuGroup: 'despacho' }),
  R('/admin/historial-despacho', 'Hist. despacho',   'logistica', LOGISTICA_OPERATIVA, { icon: History, menuGroup: 'despacho' }),
  R('/comercial/mapa',           'Reparto en vivo',  'logistica', ['super_admin', 'comercial', 'logistica'], { icon: Navigation, menuGroup: 'despacho' }),
  // ── Logística: operaciones y flota ────────────────────────────────────────
  R('/admin/flota',              'Flota',            'logistica', ['super_admin', 'logistica'], { icon: Truck, menuGroup: 'flota' }),
  R('/admin/incidencias',        'Incidencias',      'logistica', ['super_admin', 'logistica'], { icon: AlertTriangle, menuGroup: 'flota' }),
  R('/movimientos',              'Movimientos',      'comercial', ['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'], { icon: BarChart2, menuGroup: 'facturacion' }),
  R('/admin/clima',              'Clima',            'logistica', ['super_admin', 'logistica', 'gerente_comercial', 'comercial'], { icon: Cloud, menuGroup: 'flota' }),

  // ── Logística: planta y expedición (caja / muelle / seguridad) ────────────
  R('/caja',                         'Caja',                 'tesoreria', CAJA, { deepLink: true }),
  R('/caja/remitos',                 'Remitos de carga',     'logistica', CAJA, { icon: ClipboardList, menuGroup: 'expedicion' }),
  R('/caja/ventanilla',              'Ventanilla',           'tesoreria', CAJA, { icon: ShoppingCart, menuGroup: 'caja', externa: true }),
  R('/caja/cobranzas',               'Cobranzas',            'tesoreria', CAJA, { icon: HandCoins, menuGroup: 'caja' }),
  R('/caja/liquidaciones',           'Liquidaciones',        'tesoreria', CAJA, { icon: Scale, menuGroup: 'caja', externa: true }),
  R('/caja/rendiciones',             'Mi caja',              'tesoreria', CAJA, { icon: Wallet, menuGroup: 'caja' }),
  R('/caja/entregas',                'Entrega a tesorería',  'tesoreria', CAJA, { icon: Landmark, menuGroup: 'caja' }),
  R('/caja/liquidaciones/historial', 'Historial',            'tesoreria', CAJA_HISTORIAL, { icon: History, menuGroup: 'caja' }),
  R('/caja/rendiciones/historial',   'Historial de cierres', 'tesoreria', CAJA_HISTORIAL, { deepLink: true }),
  R('/muelle',                       'Muelle',               'logistica', ['muelle', 'super_admin'], { icon: Warehouse, menuGroup: 'expedicion', rolesMenu: ['muelle'] }),
  R('/muelle/tv',                    'Muelle · pantalla',    'logistica', ['muelle', 'super_admin'], { icon: Tv }),
  R('/seguridad',                    'Seguridad (salidas)',  'logistica', ['seguridad', 'super_admin'], { icon: Truck, menuGroup: 'expedicion', rolesMenu: ['seguridad'] }),

  // ── Logística: producción de hielo ────────────────────────────────────────
  R('/produccion',                  'Cargar producción',  'produccion', ['produccion_hielo'], { icon: Package }),
  R('/produccion/resumen',          'Resumen',            'produccion', PRODUCCION_ENCARGADO, { icon: LayoutDashboard, menuGroup: 'produccion' }),
  R('/produccion/listado',          'Listado',            'produccion', ['gerente_general', 'gerente_comercial', 'comercial', 'logistica', 'produccion_encargado', 'super_admin'], { icon: ClipboardList, menuGroup: 'produccion' }),
  R('/produccion/partes',           'Partes de máquinas', 'produccion', PRODUCCION_ENCARGADO, { icon: Gauge, menuGroup: 'produccion' }),
  R('/produccion/operarios',        'Operarios',          'produccion', PRODUCCION_ENCARGADO, { icon: Users, menuGroup: 'configuracion' }),
  R('/produccion/plantas',          'Plantas',            'produccion', PRODUCCION_ENCARGADO, { icon: Factory, menuGroup: 'configuracion' }),
  R('/produccion/ticket/:palletId', 'Ticket de pallet',   'produccion', PALLET, { deepLink: true, externa: true }),
  R('/produccion/ficha/:palletId',  'Ficha de pallet',    'produccion', PALLET, { deepLink: true, externa: true }),

  // ── Logística: tesorería ──────────────────────────────────────────────────
  R('/tesoreria',                         'Tesorería en vivo',  'tesoreria', TESORERIA, { icon: Activity, menuGroup: 'tesoreria' }),
  R('/tesoreria/liquidaciones',           'Liquidaciones',      'tesoreria', TESORERIA, { icon: Scale, menuGroup: 'tesoreria' }),
  R('/tesoreria/rendiciones',             'Rendiciones',        'tesoreria', TESORERIA, { icon: ShieldCheck, menuGroup: 'tesoreria' }),
  R('/tesoreria/entregas',                'Entregas de caja',   'tesoreria', TESORERIA, { icon: Landmark, menuGroup: 'tesoreria' }),
  R('/tesoreria/anulaciones',             'Anulaciones',        'tesoreria', TESORERIA, { icon: Ban, menuGroup: 'tesoreria' }),
  R('/tesoreria/rendiciones/historial',   'Historial',          'tesoreria', TESORERIA, { icon: History, menuGroup: 'tesoreria' }),
  R('/tesoreria/liquidaciones/historial', 'Historial de liquidaciones', 'tesoreria', TESORERIA, { deepLink: true }),

  // ── Chofer (calle) ────────────────────────────────────────────────────────
  R('/chofer',                   'Inicio',          'logistica', ['chofer'], { icon: Home }),
  R('/chofer/venta',             'Vender',          'logistica', ['chofer'], { icon: Package }),
  R('/chofer/ventas',            'Facturas',        'logistica', ['chofer'], { icon: FileText, externa: true }),
  R('/chofer/map',               'Ruta',            'logistica', ['chofer'], { icon: Navigation }),
  R('/chofer/cobrar',            'Cobrar',          'logistica', ['chofer'], { deepLink: true }),
  R('/chofer/entregar/:orderId', 'Entregar pedido', 'logistica', ['chofer'], { deepLink: true }),

  // ── Heladeras y taller ────────────────────────────────────────────────────
  R('/heladeras',                  'Heladeras',             'heladeras', ['super_admin', 'heladeras', 'heladeras_encargado', 'gerente_comercial', 'comercial'], { icon: Snowflake }),
  R('/heladeras/taller',           'Tablero de taller',     'heladeras', ['super_admin', 'heladeras', 'heladeras_encargado', 'gerente_comercial'], { icon: Snowflake, menuGroup: 'taller' }),
  R('/heladeras/asignacion',       'Asignación de equipos', 'heladeras', ['super_admin', 'heladeras_encargado', 'gerente_comercial', 'comercial'], { icon: Truck, menuGroup: 'taller' }),
  R('/heladeras/toma-service',     'Toma de service',       'heladeras', HELADERAS_SERVICE, { icon: Wrench, menuGroup: 'service' }),
  R('/heladeras/consulta-service', 'Consulta de service',   'heladeras', HELADERAS_SERVICE, { icon: Search, menuGroup: 'service' }),
  R('/heladeras/mapa',             'Mapa y preventivos',    'heladeras', HELADERAS_REPORTES, { icon: MapIcon, menuGroup: 'service' }),
  R('/heladeras/equipos',          'Padrón de equipos',     'heladeras', HELADERAS_MAESTROS, { icon: Package, menuGroup: 'stock' }),
  R('/heladeras/panol',            'Pañol de repuestos',    'heladeras', HELADERAS_MAESTROS, { icon: Package, menuGroup: 'stock' }),
  R('/heladeras/informes',         'Informes y métricas',   'heladeras', HELADERAS_REPORTES, { icon: BarChart2, menuGroup: 'reportes' }),
  R('/heladeras/ranking',          'Ranking de consumo',    'heladeras', ['super_admin', 'heladeras_encargado', 'gerente_comercial', 'comercial'], { icon: TrendingUp, menuGroup: 'reportes' }),
  R('/heladeras/modelos',          'Modelos',               'heladeras', HELADERAS_MAESTROS, { icon: Layers, menuGroup: 'configuracion' }),
  R('/heladeras/tecnicos',         'Técnicos',              'heladeras', HELADERAS_MAESTROS, { icon: Users, menuGroup: 'configuracion' }),
  R('/heladeras/catalogos',        'Catálogos de service',  'heladeras', HELADERAS_MAESTROS, { icon: ClipboardList, menuGroup: 'configuracion' }),
  R('/heladeras/ficha/:heladeraId',    'Ficha de heladera',    'heladeras', ['super_admin', 'heladeras', 'heladeras_encargado', 'gerente_comercial', 'comercial', 'tecnico', 'supervisor'], { deepLink: true, externa: true }),
  R('/heladeras/etiqueta/:heladeraId', 'Etiqueta de heladera', 'heladeras', HELADERAS_SERVICE, { deepLink: true }),
  R('/tecnico',                    'Mis service',           'heladeras', ['tecnico'], { icon: Wrench }),

  // ── Comercial ─────────────────────────────────────────────────────────────
  R('/comercial',                 'Tablero comercial',        'comercial', ['super_admin', 'comercial'], { icon: LayoutDashboard, menuGroup: 'tablero' }),
  R('/comercial/pedidos',         'Pedidos',                  'comercial', ['super_admin', 'comercial'], { deepLink: true }),
  R('/comercial/ventas',          'Ventas',                   'comercial', REPORTES, { icon: TrendingUp, menuGroup: 'tablero' }),
  R('/usuarios',                  'Clientes',                 'comercial', OFICINA_CLIENTES, { icon: Users, menuGroup: 'clientes' }),
  R('/admin/mapa-clientes',       'Mapa de clientes',         'comercial', OFICINA_CLIENTES, { icon: MapIcon, menuGroup: 'clientes' }),
  R('/admin/visitas',             'Visitas',                  'comercial', ['super_admin', 'logistica'], { icon: ClipboardList, menuGroup: 'clientes' }),
  R('/admin/precios',             'Precios',                  'comercial', ['super_admin', 'logistica', 'comercial', 'gerente_comercial'], { icon: Tag, menuGroup: 'precios' }),
  R('/comercial/reporte-precios', 'Reporte de precios',       'comercial', REPORTES, { icon: DollarSign, menuGroup: 'precios' }),
  R('/admin/comprobantes',        'Comprobantes de clientes', 'comercial', ['super_admin', 'facturacion'], { icon: Files, menuGroup: 'facturacion', externa: true }),
  R('/admin/recupero-facturas',   'Recupero de facturas',     'comercial', ['super_admin', 'facturacion'], { icon: FileText, menuGroup: 'facturacion' }),
  R('/anulaciones',               'Anulaciones',              'comercial',
    ['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion', 'tesoreria', 'supervisor', 'heladeras_encargado', 'produccion_encargado'],
    { icon: Ban, menuGroup: 'facturacion', externa: true }),

  // ── Comercial: supervisor de cobranzas (calle) ────────────────────────────
  R('/supervisor',              'Inicio',            'comercial', SUPERVISOR, { icon: Home, menuGroup: 'supervisores' }),
  R('/supervisor/clientes',     'Mis clientes',      'comercial', SUPERVISOR, { deepLink: true }),
  R('/supervisor/buscar',       'Buscar cliente',    'comercial', SUPERVISOR, { deepLink: true }),
  R('/supervisor/cobrar',       'Cobrar',            'comercial', SUPERVISOR, { deepLink: true }),
  R('/supervisor/historial',    'Mis cobranzas',     'comercial', SUPERVISOR, { deepLink: true }),
  R('/supervisor/reparto',      'Reparto en vivo',   'comercial', SUPERVISOR, { deepLink: true }),
  R('/supervisor/cliente/:uid', 'Ficha del cliente', 'comercial', SUPERVISOR, { deepLink: true, externa: true }),
  R('/supervisor/vender',       'Vender',            'comercial', SUPERVISOR, { deepLink: true }),
  R('/supervisor/ventas',       'Mis ventas',        'comercial', SUPERVISOR, { deepLink: true }),

  // ── Administración y gerencia ─────────────────────────────────────────────
  R('/admin',           'Panel de control',    'administracion', ['super_admin'], { icon: LayoutDashboard, menuGroup: 'sistema' }),
  R('/admin/usuarios',  'Usuarios & Roles',    'administracion', ['super_admin'], { icon: UserCog, menuGroup: 'sistema' }),
  R('/admin/general',   'Ajustes generales',   'administracion', ['super_admin'], { icon: Settings, menuGroup: 'sistema' }),
  R('/gerente',         'Panel de directores', 'administracion', ['gerente_general', 'super_admin'], { icon: LayoutDashboard, menuGroup: 'gerencia' }),
]

// ── Menús ───────────────────────────────────────────────────────────────────

/** Un ítem de menú: el path, o el path con un nombre distinto al canónico (solo para entradas a otra pantalla, como "Supervisores"). */
export type EntradaMenu = string | { path: string; label: string; icon?: LucideIcon }

export interface GrupoSidebar { id: MenuGroup; label: string; entradas: EntradaMenu[] }

/**
 * Sidebars de los cuatro dominios de escritorio (DominioLayout). El orden es
 * el que se ve. Cada rol ve solo los ítems de sus rutas; qué dominios tiene
 * cada rol lo dice `ROLE_SISTEMAS` en utils/sistemas.ts.
 */
export const SIDEBARS: Record<Sistema, GrupoSidebar[]> = {
  // Logística: la mercadería. Termina cuando el camión sale por el portón.
  logistica: [
    { id: 'despacho',   label: 'Despacho & Rutas',    entradas: ['/logistica/resumen', '/logistica', '/admin/monitoreo', '/admin/historial-despacho', '/comercial/mapa'] },
    { id: 'flota',      label: 'Operaciones & Flota', entradas: ['/admin/flota', '/admin/incidencias', '/admin/clima'] },
    // La carga del camión: el remito lo emite caja, el muelle lo entrega y
    // seguridad controla la salida. Un cajero con el rol adicional muelle o
    // seguridad (2026-09-12: caja carga la descarga mientras muelle no tiene
    // tablet) llega a esos paneles desde acá.
    { id: 'expedicion', label: 'Muelle & Expedición', entradas: ['/caja/remitos', '/muelle', '/seguridad'] },
  ],
  // Producción & Stock: lo que se fabrica. Las líneas que vienen (agua,
  // plástico y bobinas) y el mantenimiento electromecánico de planta entran
  // como grupos nuevos acá, sin tocar el resto de la navegación.
  produccion: [
    { id: 'produccion',    label: 'Hielo',         entradas: ['/produccion/resumen', '/produccion/listado', '/produccion/partes'] },
    { id: 'configuracion', label: 'Configuración', entradas: ['/produccion/operarios', '/produccion/plantas'] },
  ],
  // Tesorería & Cajas: la plata y los valores, de la ventanilla al arqueo.
  tesoreria: [
    { id: 'caja',      label: 'Caja & Ventanilla', entradas: ['/caja/ventanilla', '/caja/cobranzas', '/caja/liquidaciones', '/caja/rendiciones', '/caja/entregas', '/caja/liquidaciones/historial'] },
    { id: 'tesoreria', label: 'Tesorería',         entradas: ['/tesoreria', '/tesoreria/liquidaciones', '/tesoreria/rendiciones', '/tesoreria/entregas', '/tesoreria/anulaciones', '/tesoreria/rendiciones/historial'] },
  ],
  comercial: [
    // El listado de producción es consulta de stock para gerencia, comercial y
    // logística, que no tienen el dominio Producción.
    { id: 'tablero',      label: 'Tablero',      entradas: ['/comercial', '/comercial/ventas', '/comercial/mapa', '/produccion/listado'] },
    { id: 'clientes',     label: 'Clientes',     entradas: ['/usuarios', '/admin/mapa-clientes', '/admin/visitas'] },
    { id: 'precios',      label: 'Precios',      entradas: ['/admin/precios', '/comercial/reporte-precios'] },
    // /anulaciones: DominioLayout la esconde a quien no tiene el permiso individual `autorizaAnulaciones` (salvo super_admin).
    { id: 'facturacion',  label: 'Facturación',  entradas: ['/movimientos', '/admin/comprobantes', '/admin/recupero-facturas', '/anulaciones'] },
    { id: 'supervisores', label: 'Supervisores', entradas: [{ path: '/supervisor', label: 'Supervisores (calle)', icon: UserCheck }] },
  ],
  heladeras: [
    { id: 'taller',        label: 'Taller',            entradas: ['/heladeras/taller', '/heladeras/asignacion'] },
    { id: 'service',       label: 'Soporte & Service', entradas: ['/heladeras/toma-service', '/heladeras/consulta-service', '/heladeras/mapa'] },
    { id: 'stock',         label: 'Activos & Stock',   entradas: ['/heladeras/equipos', '/heladeras/panol'] },
    { id: 'reportes',      label: 'Reportes',          entradas: ['/heladeras/informes', '/heladeras/ranking'] },
    { id: 'configuracion', label: 'Configuración',     entradas: ['/heladeras/modelos', '/heladeras/tecnicos', '/heladeras/catalogos'] },
  ],
  administracion: [
    { id: 'sistema',  label: 'Administración', entradas: ['/admin', '/admin/usuarios', '/admin/general'] },
    // La bandeja de anulaciones vive en Comercial y en Tesorería; acá sobraba.
    { id: 'gerencia', label: 'Gerencia',       entradas: ['/gerente'] },
  ],
}

/**
 * Home de cada dominio, en orden de preferencia: el primero que el usuario
 * puede abrir. Si ninguno aplica, el primer ítem visible de su sidebar.
 */
const HOME_SISTEMA: Record<Sistema, string[]> = {
  logistica:      ['/logistica', '/logistica/resumen', '/admin/monitoreo', '/caja/remitos', '/muelle', '/seguridad'],
  produccion:     ['/produccion/resumen', '/produccion/listado'],
  tesoreria:      ['/tesoreria', '/caja/ventanilla', '/caja/rendiciones', '/caja/liquidaciones/historial'],
  comercial:      ['/comercial', '/usuarios', '/movimientos', '/supervisor'],
  heladeras:      ['/heladeras', '/heladeras/taller'],
  administracion: ['/admin', '/gerente'],
}

/**
 * Navbar clásico, por rol (roles de calle y de planta sin shell de escritorio,
 * y las pocas pantallas standalone que todavía lo usan). Vacío = ese rol
 * nunca llega a una pantalla con Navbar. El Navbar suma /anulaciones a quien
 * tiene el permiso individual, y para los roles multi-dominio parados en
 * heladeras usa la lista de `heladeras`.
 */
export const NAVBAR: Record<UserRole, string[]> = {
  super_admin:          [],
  gerente_general:      ['/gerente', '/admin/monitoreo', '/usuarios', '/admin/mapa-clientes', '/comercial/ventas'],
  gerente_comercial:    ['/logistica', '/admin/historial-despacho', '/admin/monitoreo', '/admin/clima', '/usuarios', '/admin/precios', '/movimientos', '/comercial/ventas'],
  logistica:            ['/logistica', '/admin/historial-despacho', '/admin/monitoreo', '/admin/visitas', '/admin/flota', '/admin/precios', '/admin/clima', '/usuarios', '/admin/mapa-clientes'],
  comercial:            ['/comercial', '/usuarios', '/admin/mapa-clientes', '/movimientos', '/admin/precios', '/comercial/reporte-precios', '/comercial/mapa'],
  facturacion:          ['/movimientos', '/admin/comprobantes', '/comercial/ventas', '/comercial/reporte-precios', '/usuarios', '/admin/mapa-clientes'],
  cliente:              ['/dashboard', '/nuevo-pedido', '/historial', '/mis-heladeras', '/perfil'],
  chofer:               ['/chofer', '/chofer/venta', '/chofer/ventas', '/chofer/map'],
  heladeras:            ['/heladeras'],
  heladeras_encargado:  ['/heladeras'],
  tecnico:              ['/tecnico'],
  produccion_hielo:     ['/produccion'],
  produccion_encargado: [],
  caja:                 [],
  muelle:               ['/muelle'],
  seguridad:            ['/seguridad'],
  supervisor:           ['/supervisor'],
  tesoreria:            [],
}

/** Accesos del panel de control del super_admin (/admin), por área y en orden. */
export const PANEL: Array<{ id: string; titulo: string; entradas: EntradaMenu[] }> = [
  { id: 'admin',       titulo: 'Administración',         entradas: ['/admin/usuarios', '/admin/general', '/usuarios', '/admin/mapa-clientes', '/gerente'] },
  { id: 'facturacion', titulo: 'Facturación',            entradas: ['/movimientos', '/admin/comprobantes', '/admin/recupero-facturas', '/anulaciones'] },
  { id: 'logistica',   titulo: 'Logística',              entradas: ['/logistica', '/admin/historial-despacho', '/admin/monitoreo', '/admin/visitas', '/admin/incidencias', '/admin/clima', '/admin/flota', '/admin/precios'] },
  { id: 'comercial',   titulo: 'Comercial',              entradas: ['/comercial', '/comercial/mapa', '/comercial/reporte-precios', '/comercial/ventas'] },
  { id: 'expedicion',  titulo: 'Expedición y tesorería', entradas: ['/caja/remitos', '/caja/ventanilla', '/caja/liquidaciones', '/muelle', '/muelle/tv', '/seguridad', '/tesoreria', '/tesoreria/rendiciones', '/tesoreria/entregas', { path: '/supervisor', label: 'Supervisor (calle)', icon: UserCheck }] },
  { id: 'heladeras',   titulo: 'Heladeras',              entradas: ['/heladeras', '/heladeras/taller', '/heladeras/asignacion', '/heladeras/ranking', '/heladeras/consulta-service', '/heladeras/toma-service', '/heladeras/informes', '/heladeras/mapa', '/heladeras/modelos', '/heladeras/catalogos', '/heladeras/tecnicos', '/heladeras/equipos', '/heladeras/panol'] },
  { id: 'produccion',  titulo: 'Producción',             entradas: ['/produccion/resumen', '/produccion/listado', '/produccion/operarios', '/produccion/plantas'] },
]

// ── Consultas ───────────────────────────────────────────────────────────────

const porPath = new Map(CATALOGO.map((r) => [r.path, r]))

export function rutaDe(path: string): RutaConfig {
  const r = porPath.get(path)
  if (!r) throw new Error(`Ruta fuera del catálogo: ${path}`)
  return r
}

/** `allowedRoles` del <ProtectedRoute> de esa ruta (en App.tsx). */
export const rolesDe = (path: string): UserRole[] => rutaDe(path).roles

export interface ItemMenu { to: string; label: string; icon: LucideIcon; roles: UserRole[] }
export interface GrupoMenu { id: string; label: string; items: ItemMenu[] }

export const pathDe = (e: EntradaMenu) => (typeof e === 'string' ? e : e.path)

function itemDe(entrada: EntradaMenu): ItemMenu {
  const r = rutaDe(pathDe(entrada))
  const icon = (typeof entrada === 'string' ? undefined : entrada.icon) ?? r.icon
  if (!icon) throw new Error(`La ruta ${r.path} va en un menú pero no tiene ícono`)
  const label = typeof entrada === 'string' ? r.label : entrada.label
  return { to: r.path, label, icon, roles: r.rolesMenu ?? r.roles }
}

const sinRoles = ({ to, label, icon }: ItemMenu) => ({ to, label, icon })

/** Un link suelto (path, nombre e ícono canónicos) para armarlo a mano en un menú. */
export const linkDe = (path: string) => sinRoles(itemDe(path))

/** Grupos del sidebar de un dominio, con todos sus ítems (sin filtrar por usuario). */
export const gruposDe = (sistema: Sistema): GrupoMenu[] =>
  SIDEBARS[sistema].map((g) => ({ id: g.id, label: g.label, items: g.entradas.map(itemDe) }))

type UsuarioRoles = Pick<UserProfile, 'rol' | 'rolesExtra'>

/** Grupos de un dominio con los ítems que ESTE usuario puede ver por sus roles. */
export const gruposVisibles = (user: UsuarioRoles | null | undefined, sistema: Sistema): GrupoMenu[] =>
  gruposDe(sistema)
    .map((g) => ({ ...g, items: g.items.filter((i) => tieneAlgunRol(user, i.roles)) }))
    .filter((g) => g.items.length > 0)

/** ¿Esta ruta está en el sidebar de ese dominio? */
export const estaEnSidebar = (sistema: Sistema, path: string): boolean =>
  SIDEBARS[sistema].some((g) => g.entradas.some((e) => pathDe(e) === path))

const DOMINIO_A_SISTEMA = (d: Dominio): Sistema | null => (d === 'portal' ? null : d)

/** Dominio de escritorio de una ruta: el primer sidebar que la lista; si ninguno, por su `dominio`. */
export function sistemaDeRuta(path: string): Sistema | null {
  for (const s of Object.keys(SIDEBARS) as Sistema[]) if (estaEnSidebar(s, path)) return s
  const r = porPath.get(path)
  return r ? DOMINIO_A_SISTEMA(r.dominio) : null
}

/** Adónde entra este usuario en un dominio (ver HOME_SISTEMA). */
export function homeDeSistema(sistema: Sistema, user: UsuarioRoles): string {
  const preferido = HOME_SISTEMA[sistema].find((p) => tieneAlgunRol(user, rolesDe(p)))
  if (preferido) return preferido
  const primero = gruposVisibles(user, sistema)[0]?.items[0]
  return primero?.to ?? '/'
}

/** Primer ítem de un grupo que el usuario puede abrir (respeta pestañas permitidas). */
export function primerAccesoDe(sistema: Sistema, grupo: MenuGroup, user: (UsuarioRoles & Pick<UserProfile, 'pestanasPermitidas'>) | null): string | undefined {
  if (!user) return undefined
  return gruposVisibles(user, sistema)
    .find((g) => g.id === grupo)?.items
    .find((i) => !user.pestanasPermitidas || user.pestanasPermitidas.includes(i.to))?.to
}

/** Links del Navbar clásico para un rol. */
export const linksNavbarDe = (rol: UserRole): Array<Omit<ItemMenu, 'roles'>> =>
  NAVBAR[rol].map((p) => sinRoles(itemDe(p)))

/** Accesos del panel de control, por área. */
export const accesosDelPanel = () =>
  PANEL.map((g) => ({ id: g.id, titulo: g.titulo, accesos: g.entradas.map((e) => sinRoles(itemDe(e))) }))

/** Todas las entradas que aparecen en algún menú (para los tests). */
export const pathsEnMenus = (): string[] => [
  ...Object.values(SIDEBARS).flatMap((gs) => gs.flatMap((g) => g.entradas.map(pathDe))),
  ...Object.values(NAVBAR).flat(),
  ...PANEL.flatMap((g) => g.entradas.map(pathDe)),
]
