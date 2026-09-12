import type { LucideIcon } from 'lucide-react'
import {
  Activity, AlertTriangle, Ban, BarChart2, CalendarDays, ClipboardList, Cloud, DollarSign, Factory, FileText, Files,
  Gauge, HandCoins, History, Home, Landmark, LayoutDashboard, Layers, Map as MapIcon, Navigation, Package, Plus, Scale, Search,
  Settings, ShieldCheck, ShoppingCart, Snowflake, Store, Tag, TrendingUp, Truck, Tv, UserCheck, UserCircle, UserCog,
  Users, Wallet, Warehouse, Wrench,
} from 'lucide-react'
import type { UserRole } from '@/types'

/**
 * CATÁLOGO MAESTRO DE RUTAS (fase 1 del reordenamiento, 2026-09-12).
 *
 * Única fuente de verdad de la navegación: qué pantallas hay, quién puede
 * entrar (los `allowedRoles` de cada <ProtectedRoute> en App.tsx salen de
 * acá vía `rolesDe`), con qué nombre e ícono se muestran y en qué menús
 * aparecen (sidebars de cada sistema, Navbar clásico, panel de control).
 *
 * Reglas:
 *  - Un path, una entrada, un `label` canónico. Los menús no inventan
 *    nombres (antes había 9 menús a mano con hasta 3 nombres por pantalla).
 *  - `roles: []` = ruta pública. `requiereAuth` = cualquier usuario logueado
 *    sin lista de roles (/sistema).
 *  - `deepLink` = detalle / impresión / kiosco / alias: se llega desde otra
 *    pantalla, un QR o una push; no va en ningún menú a propósito.
 *  - `externa` = la URL está impresa o viaja por push / mail / QR: no se
 *    renombra nunca sin migrar lo que la apunta.
 *  - El ORDEN de cada menú lo dan las listas de abajo (SIDEBARS, NAVBAR,
 *    PANEL, IR_A), no el orden del catálogo.
 *
 * `src/rutas/catalogo.test.ts` verifica que catálogo y App.tsx coincidan,
 * que ningún menú apunte a una ruta inexistente y que los menús no ofrezcan
 * un link a quien la ruta le niega el paso.
 */

export type Dominio = 'logistica' | 'heladeras' | 'comercial' | 'admin' | 'operativo' | 'portal'
export type Sidebar = 'logistica' | 'heladeras' | 'produccion' | 'expedicion' | 'tesoreria' | 'backoffice'
/** Reservado para el reordenamiento de los menús por dominio (parte 2 de la fase 1, todavía sin definir). */
export type MenuGroup = 'despacho' | 'flota' | 'operaciones' | 'taller' | 'service' | 'stock' | 'clientes' | 'facturacion' | 'sistema'

export interface RutaConfig {
  path: string
  /** Nombre canónico de la pantalla, el mismo en todos los menús. */
  label: string
  icon?: LucideIcon
  dominio: Dominio
  /** Roles autorizados: lo que exige <ProtectedRoute>. Vacío = pública. */
  roles: UserRole[]
  menuGroup?: MenuGroup
  /** Cualquier usuario autenticado y activo, sin lista de roles. */
  requiereAuth?: boolean
  /** Detalle / impresión / kiosco / alias: se llega desde otra pantalla, un QR o una push. */
  deepLink?: boolean
  /** La URL está impresa o viaja por push / mail / QR: no se renombra. */
  externa?: boolean
  /**
   * Roles que ven el ítem en los menús cuando NO son los de la ruta. Son las
   * excepciones históricas que se conservan tal cual (2026-09-12):
   *  - /gerente: en el sidebar de logística lo ve solo gerente_general;
   *  - /heladeras/informes y /heladeras/mapa: gerente_general entra por el
   *    link "Ver informes" del panel de directores, no por el sidebar;
   *  - /produccion/listado: gerencia / logística / comercial lo abren con el
   *    Navbar clásico, no desde el sidebar del encargado;
   *  - /muelle y /seguridad: en el sidebar de expedición se muestran solo al
   *    cajero con ese rol adicional.
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
  R('/empresa',              'Ingreso del equipo',            'admin',     []),
  R('/choferes',             'Ingreso de choferes',           'operativo', []),
  R('/tecnicos',             'Ingreso de técnicos',           'heladeras', []),
  R('/produccion-torcuato',  'Ingreso producción Don Torcuato', 'operativo', []),
  R('/produccion-merlo',     'Ingreso producción Merlo',      'operativo', []),
  R('/planta',               'Ingreso de planta (alias viejo)', 'operativo', [], { deepLink: true }),
  R('/login',                'Ingreso (alias viejo)',         'portal',    [], { deepLink: true }),
  R('/register',             'Registro de cliente',           'portal',    []),
  R('/forgot-password',      'Recuperar contraseña',          'portal',    []),
  R('/pendiente',            'Cuenta pendiente de aprobación', 'portal',   []),
  R('/calculadora-rolito',   'Calculadora de hielo',          'comercial', []),
  R('/turnos/:plantaId',     'Turnos de ventanilla',          'operativo', [], { deepLink: true, externa: true }),
  R('/sistema',              'Elegir sistema',                'admin',     [], { requiereAuth: true, deepLink: true }),

  // ── Portal del cliente ────────────────────────────────────────────────────
  R('/sucursal',       'Elegir sucursal', 'portal', ['cliente'], { deepLink: true }),
  R('/dashboard',      'Inicio',          'portal', ['cliente'], { icon: Home }),
  R('/nuevo-pedido',   'Nuevo pedido',    'portal', ['cliente'], { icon: Plus }),
  R('/historial',      'Historial',       'portal', ['cliente'], { icon: History }),
  R('/mis-heladeras',  'Mis heladeras',   'portal', ['cliente'], { icon: Snowflake }),
  R('/perfil',         'Mi perfil',       'portal', ['cliente'], { icon: UserCircle }),

  // ── Logística (oficina) ───────────────────────────────────────────────────
  R('/logistica',                'Planificación',    'logistica', LOGISTICA_OPERATIVA, { icon: CalendarDays }),
  R('/admin/planificacion',      'Planificación (alias viejo)', 'logistica', LOGISTICA_OPERATIVA, { deepLink: true }),
  R('/logistica/resumen',        'Resumen',          'logistica', LOGISTICA_OPERATIVA, { icon: LayoutDashboard }),
  R('/admin/historial-despacho', 'Hist. despacho',   'logistica', LOGISTICA_OPERATIVA, { icon: History }),
  R('/admin/monitoreo',          'Monitoreo',        'logistica', ['super_admin', 'logistica', 'gerente_general', 'gerente_comercial'], { icon: Activity }),
  R('/admin/incidencias',        'Incidencias',      'logistica', ['super_admin', 'logistica'], { icon: AlertTriangle }),
  R('/admin/visitas',            'Visitas',          'logistica', ['super_admin', 'logistica'], { icon: ClipboardList }),
  R('/admin/clima',              'Clima',            'logistica', ['super_admin', 'logistica', 'gerente_comercial', 'comercial'], { icon: Cloud }),
  R('/comercial/mapa',           'Reparto en vivo',  'logistica', ['super_admin', 'comercial', 'logistica'], { icon: Navigation }),
  R('/admin/flota',              'Flota',            'logistica', ['super_admin', 'logistica'], { icon: Truck }),

  // ── Comercial y facturación (oficina) ─────────────────────────────────────
  R('/comercial',                 'Tablero comercial',        'comercial', ['super_admin', 'comercial'], { icon: LayoutDashboard }),
  R('/comercial/pedidos',         'Pedidos',                  'comercial', ['super_admin', 'comercial'], { deepLink: true }),
  R('/usuarios',                  'Clientes',                 'comercial', OFICINA_CLIENTES, { icon: Users }),
  R('/admin/mapa-clientes',       'Mapa de clientes',         'comercial', OFICINA_CLIENTES, { icon: MapIcon }),
  R('/admin/precios',             'Precios',                  'comercial', ['super_admin', 'logistica', 'comercial', 'gerente_comercial'], { icon: Tag }),
  R('/comercial/reporte-precios', 'Reporte de precios',       'comercial', REPORTES, { icon: DollarSign }),
  R('/comercial/ventas',          'Ventas',                   'comercial', REPORTES, { icon: TrendingUp }),
  R('/movimientos',               'Movimientos',              'comercial', ['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion'], { icon: BarChart2 }),
  R('/admin/comprobantes',        'Comprobantes de clientes', 'comercial', ['super_admin', 'facturacion'], { icon: Files, externa: true }),
  R('/admin/recupero-facturas',   'Recupero de facturas',     'comercial', ['super_admin', 'facturacion'], { icon: FileText }),
  R('/anulaciones',               'Anulaciones',              'comercial',
    ['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion', 'tesoreria', 'supervisor', 'heladeras_encargado', 'produccion_encargado'],
    { icon: Ban, externa: true }),

  // ── Administración y gerencia ─────────────────────────────────────────────
  R('/admin',           'Panel de control',    'admin', ['super_admin'], { icon: LayoutDashboard }),
  R('/admin/usuarios',  'Usuarios & Roles',    'admin', ['super_admin'], { icon: UserCog }),
  R('/admin/general',   'Ajustes generales',   'admin', ['super_admin'], { icon: Settings }),
  R('/gerente',         'Panel de directores', 'admin', ['gerente_general', 'super_admin'], { icon: LayoutDashboard, rolesMenu: ['gerente_general'] }),

  // ── Chofer (calle) ────────────────────────────────────────────────────────
  R('/chofer',                   'Inicio',          'operativo', ['chofer'], { icon: Home }),
  R('/chofer/venta',             'Vender',          'operativo', ['chofer'], { icon: Package }),
  R('/chofer/ventas',            'Facturas',        'operativo', ['chofer'], { icon: FileText, externa: true }),
  R('/chofer/map',               'Ruta',            'operativo', ['chofer'], { icon: Navigation }),
  R('/chofer/cobrar',            'Cobrar',          'operativo', ['chofer'], { deepLink: true }),
  R('/chofer/entregar/:orderId', 'Entregar pedido', 'operativo', ['chofer'], { deepLink: true }),

  // ── Supervisor de cobranzas (calle) ───────────────────────────────────────
  R('/supervisor',              'Inicio',            'comercial', SUPERVISOR, { icon: Home }),
  R('/supervisor/clientes',     'Mis clientes',      'comercial', SUPERVISOR, { deepLink: true }),
  R('/supervisor/buscar',       'Buscar cliente',    'comercial', SUPERVISOR, { deepLink: true }),
  R('/supervisor/cobrar',       'Cobrar',            'comercial', SUPERVISOR, { deepLink: true }),
  R('/supervisor/historial',    'Mis cobranzas',     'comercial', SUPERVISOR, { deepLink: true }),
  R('/supervisor/reparto',      'Reparto en vivo',   'comercial', SUPERVISOR, { deepLink: true }),
  R('/supervisor/cliente/:uid', 'Ficha del cliente', 'comercial', SUPERVISOR, { deepLink: true, externa: true }),
  R('/supervisor/vender',       'Vender',            'comercial', SUPERVISOR, { deepLink: true }),
  R('/supervisor/ventas',       'Mis ventas',        'comercial', SUPERVISOR, { deepLink: true }),

  // ── Heladeras y taller ────────────────────────────────────────────────────
  R('/heladeras',                  'Heladeras',             'heladeras', ['super_admin', 'heladeras', 'heladeras_encargado', 'gerente_comercial', 'comercial'], { icon: Snowflake }),
  R('/heladeras/taller',           'Tablero de taller',     'heladeras', ['super_admin', 'heladeras', 'heladeras_encargado', 'gerente_comercial'], { icon: Snowflake }),
  R('/heladeras/asignacion',       'Asignación de equipos', 'heladeras', ['super_admin', 'heladeras_encargado', 'gerente_comercial', 'comercial'], { icon: Truck }),
  R('/heladeras/toma-service',     'Toma de service',       'heladeras', HELADERAS_SERVICE, { icon: Wrench }),
  R('/heladeras/consulta-service', 'Consulta de service',   'heladeras', HELADERAS_SERVICE, { icon: Search }),
  R('/heladeras/mapa',             'Mapa y preventivos',    'heladeras', HELADERAS_REPORTES, { icon: MapIcon, rolesMenu: HELADERAS_SERVICE }),
  R('/heladeras/equipos',          'Padrón de equipos',     'heladeras', HELADERAS_MAESTROS, { icon: Package }),
  R('/heladeras/panol',            'Pañol de repuestos',    'heladeras', HELADERAS_MAESTROS, { icon: Package }),
  R('/heladeras/informes',         'Informes y métricas',   'heladeras', HELADERAS_REPORTES, { icon: BarChart2, rolesMenu: HELADERAS_SERVICE }),
  R('/heladeras/ranking',          'Ranking de consumo',    'heladeras', ['super_admin', 'heladeras_encargado', 'gerente_comercial', 'comercial'], { icon: TrendingUp }),
  R('/heladeras/modelos',          'Modelos',               'heladeras', HELADERAS_MAESTROS, { icon: Layers }),
  R('/heladeras/tecnicos',         'Técnicos',              'heladeras', HELADERAS_MAESTROS, { icon: Users }),
  R('/heladeras/catalogos',        'Catálogos de service',  'heladeras', HELADERAS_MAESTROS, { icon: ClipboardList }),
  R('/heladeras/ficha/:heladeraId',    'Ficha de heladera',    'heladeras', ['super_admin', 'heladeras', 'heladeras_encargado', 'gerente_comercial', 'comercial', 'tecnico', 'supervisor'], { deepLink: true, externa: true }),
  R('/heladeras/etiqueta/:heladeraId', 'Etiqueta de heladera', 'heladeras', HELADERAS_SERVICE, { deepLink: true }),
  R('/tecnico',                    'Mis service',           'heladeras', ['tecnico'], { icon: Wrench }),

  // ── Producción de hielo ───────────────────────────────────────────────────
  R('/produccion',                  'Cargar producción',  'operativo', ['produccion_hielo'], { icon: Package }),
  R('/produccion/resumen',          'Resumen',            'operativo', PRODUCCION_ENCARGADO, { icon: LayoutDashboard }),
  R('/produccion/listado',          'Listado',            'operativo', ['gerente_general', 'gerente_comercial', 'comercial', 'logistica', 'produccion_encargado', 'super_admin'], { icon: ClipboardList, rolesMenu: PRODUCCION_ENCARGADO }),
  R('/produccion/partes',           'Partes de máquinas', 'operativo', PRODUCCION_ENCARGADO, { icon: Gauge }),
  R('/produccion/operarios',        'Operarios',          'operativo', PRODUCCION_ENCARGADO, { icon: Users }),
  R('/produccion/plantas',          'Plantas',            'operativo', PRODUCCION_ENCARGADO, { icon: Factory }),
  R('/produccion/ticket/:palletId', 'Ticket de pallet',   'operativo', PALLET, { deepLink: true, externa: true }),
  R('/produccion/ficha/:palletId',  'Ficha de pallet',    'operativo', PALLET, { deepLink: true, externa: true }),

  // ── Expedición de planta (caja / muelle / seguridad) ──────────────────────
  R('/caja',                         'Caja',                 'operativo', CAJA, { deepLink: true }),
  R('/caja/remitos',                 'Remitos de carga',     'operativo', CAJA, { icon: ClipboardList }),
  R('/caja/ventanilla',              'Ventanilla',           'operativo', CAJA, { icon: ShoppingCart, externa: true }),
  R('/caja/cobranzas',               'Cobranzas',            'operativo', CAJA, { icon: HandCoins }),
  R('/caja/liquidaciones',           'Liquidaciones',        'operativo', CAJA, { icon: Scale, externa: true }),
  R('/caja/rendiciones',             'Mi caja',              'operativo', CAJA, { icon: Wallet }),
  R('/caja/entregas',                'Entrega a tesorería',  'operativo', CAJA, { icon: Landmark }),
  R('/caja/liquidaciones/historial', 'Historial',            'operativo', CAJA_HISTORIAL, { icon: History }),
  R('/caja/rendiciones/historial',   'Historial de cierres', 'operativo', CAJA_HISTORIAL, { deepLink: true }),
  R('/muelle',                       'Muelle',               'operativo', ['muelle', 'super_admin'], { icon: Warehouse, rolesMenu: ['muelle'] }),
  R('/muelle/tv',                    'Muelle · pantalla',    'operativo', ['muelle', 'super_admin'], { icon: Tv }),
  R('/seguridad',                    'Seguridad (salidas)',  'operativo', ['seguridad', 'super_admin'], { icon: Truck, rolesMenu: ['seguridad'] }),

  // ── Tesorería ─────────────────────────────────────────────────────────────
  R('/tesoreria',                         'Tesorería en vivo',  'operativo', TESORERIA, { icon: Activity }),
  R('/tesoreria/liquidaciones',           'Liquidaciones',      'operativo', TESORERIA, { icon: Scale }),
  R('/tesoreria/rendiciones',             'Rendiciones',        'operativo', TESORERIA, { icon: ShieldCheck }),
  R('/tesoreria/entregas',                'Entregas de caja',   'operativo', TESORERIA, { icon: Landmark }),
  R('/tesoreria/anulaciones',             'Anulaciones',        'operativo', TESORERIA, { icon: Ban }),
  R('/tesoreria/rendiciones/historial',   'Historial',          'operativo', TESORERIA, { icon: History }),
  R('/tesoreria/liquidaciones/historial', 'Historial de liquidaciones', 'operativo', TESORERIA, { deepLink: true }),
]

// ── Menús: orden explícito por path; label, ícono y roles salen del catálogo ──

/** Un ítem de menú: el path, o el path con un nombre distinto al canónico (solo en el panel y en "Ir a"). */
export type EntradaMenu = string | { path: string; label: string; icon?: LucideIcon }

export interface GrupoSidebar { id: string; label: string; paths: string[] }

export const SIDEBARS: Record<Sidebar, GrupoSidebar[]> = {
  logistica: [
    { id: 'operacion',     label: 'Operación',          paths: ['/comercial', '/gerente', '/logistica/resumen', '/logistica', '/admin/historial-despacho', '/admin/monitoreo', '/admin/incidencias', '/admin/visitas', '/admin/clima', '/comercial/mapa'] },
    { id: 'clientes',      label: 'Clientes & Precios', paths: ['/usuarios', '/admin/mapa-clientes', '/comercial/reporte-precios'] },
    { id: 'configuracion', label: 'Configuración',      paths: ['/admin/flota', '/admin/precios'] },
    { id: 'reportes',      label: 'Reportes',           paths: ['/movimientos', '/comercial/ventas'] },
    // /anulaciones: LogisticaLayout la esconde a quien no tiene el permiso individual `autorizaAnulaciones` (salvo super_admin).
    { id: 'facturacion',   label: 'Facturación',        paths: ['/admin/comprobantes', '/admin/recupero-facturas', '/anulaciones'] },
  ],
  heladeras: [
    { id: 'operaciones',   label: 'Operaciones',       paths: ['/heladeras/taller', '/heladeras/asignacion'] },
    { id: 'service',       label: 'Soporte & Service', paths: ['/heladeras/toma-service', '/heladeras/consulta-service', '/heladeras/mapa'] },
    { id: 'activos',       label: 'Activos & Stock',   paths: ['/heladeras/equipos', '/heladeras/panol'] },
    { id: 'reportes',      label: 'Reportes',          paths: ['/heladeras/informes', '/heladeras/ranking'] },
    { id: 'configuracion', label: 'Configuración',     paths: ['/heladeras/modelos', '/heladeras/tecnicos', '/heladeras/catalogos'] },
  ],
  produccion: [
    { id: 'produccion',    label: 'Producción',    paths: ['/produccion/resumen', '/produccion/listado', '/produccion/partes', '/produccion/operarios'] },
    { id: 'configuracion', label: 'Configuración', paths: ['/produccion/plantas'] },
  ],
  expedicion: [
    // Un cajero con el rol adicional muelle/seguridad (2026-09-12: caja carga la
    // descarga mientras muelle no tiene tablet) llega a esos paneles desde acá.
    { id: 'expedicion', label: 'Expedición', paths: ['/caja/remitos', '/caja/ventanilla', '/caja/cobranzas', '/caja/liquidaciones', '/caja/rendiciones', '/caja/entregas', '/caja/liquidaciones/historial', '/muelle', '/seguridad'] },
  ],
  tesoreria: [
    { id: 'tesoreria', label: 'Tesorería', paths: ['/tesoreria', '/tesoreria/liquidaciones', '/tesoreria/rendiciones', '/tesoreria/entregas', '/tesoreria/anulaciones', '/tesoreria/rendiciones/historial'] },
  ],
  backoffice: [
    { id: 'backoffice', label: 'Administración', paths: ['/admin', '/admin/usuarios', '/admin/general'] },
  ],
}

/**
 * Navbar clásico, por rol. Vacío = ese rol nunca llega a una pantalla con
 * Navbar (tiene sidebar propio). El Navbar suma /anulaciones a quien tiene el
 * permiso individual, y para los roles multi-sistema parados en heladeras usa
 * la lista de `heladeras`.
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

/** Grupo "Ir a" del sidebar del Backoffice: la puerta de cada sistema y de los puestos (nombre del sistema, no de la pantalla). */
export const IR_A: EntradaMenu[] = [
  { path: '/logistica',          label: 'Logística',   icon: LayoutDashboard },
  { path: '/heladeras',          label: 'Heladeras',   icon: Snowflake },
  { path: '/produccion/resumen', label: 'Producción',  icon: Factory },
  { path: '/caja/remitos',       label: 'Caja',        icon: Store },
  { path: '/movimientos',        label: 'Facturación', icon: FileText },
  { path: '/tesoreria',          label: 'Tesorería',   icon: Landmark },
  { path: '/supervisor',         label: 'Supervisor',  icon: UserCheck },
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

const pathDe = (e: EntradaMenu) => (typeof e === 'string' ? e : e.path)

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

/** Grupos de un sidebar, con el mismo shape que `NavGroup` de utils/navGroups.ts. */
export const gruposDe = (sidebar: Sidebar): GrupoMenu[] =>
  SIDEBARS[sidebar].map((g) => ({ id: g.id, label: g.label, items: g.paths.map(itemDe) }))

/** Links del Navbar clásico para un rol. */
export const linksNavbarDe = (rol: UserRole): Array<Omit<ItemMenu, 'roles'>> =>
  NAVBAR[rol].map((p) => sinRoles(itemDe(p)))

/** Accesos del panel de control, por área. */
export const accesosDelPanel = () =>
  PANEL.map((g) => ({ id: g.id, titulo: g.titulo, accesos: g.entradas.map((e) => sinRoles(itemDe(e))) }))

/** Grupo "Ir a" del Backoffice (solo super_admin). */
export const grupoIrA = (): GrupoMenu => ({
  id: 'ir-a', label: 'Ir a',
  items: IR_A.map((e) => ({ ...itemDe(e), roles: ['super_admin'] })),
})

/** Todas las entradas que aparecen en algún menú (para los tests). */
export const pathsEnMenus = (): string[] => [
  ...Object.values(SIDEBARS).flatMap((gs) => gs.flatMap((g) => g.paths)),
  ...Object.values(NAVBAR).flat(),
  ...PANEL.flatMap((g) => g.entradas.map(pathDe)),
  ...IR_A.map(pathDe),
]
