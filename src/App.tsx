import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { tieneAlgunRol } from '@/utils/roles'
import { rolesDe, primerAccesoDe } from '@/rutas/catalogo'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { BranchProvider, useBranch } from './context/BranchContext'
import { SistemaProvider } from './context/SistemaContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoadingSpinner from './components/ui/LoadingSpinner'
import { reportError, APP_RELEASE } from './services/observability'
import { SESION_VER_COMO } from './services/firebase'
import VerComoBanner, { VerComoTerminada } from './components/layout/VerComoBanner'
import { Component, ReactNode, ErrorInfo } from 'react'

// Auth pages — carga inmediata (primera pantalla visible)
import Landing         from './pages/auth/Landing'
import LoginClientes   from './pages/auth/LoginClientes'
import LoginEmpresa    from './pages/auth/LoginEmpresa'
import LoginChofer     from './pages/auth/LoginChofer'
import LoginTecnico    from './pages/auth/LoginTecnico'
import Register        from './pages/auth/Register'
import ForgotPassword  from './pages/auth/ForgotPassword'
import PendingApproval from './pages/auth/PendingApproval'

// Todas las demás páginas — carga bajo demanda
const SeleccionSistemaPage = lazy(() => import('./pages/auth/SeleccionSistemaPage'))
const ClientDashboard  = lazy(() => import('@/pages/comercial/portal/ClientDashboard'))
const NewOrder         = lazy(() => import('@/pages/comercial/portal/NewOrder'))
const OrderHistory     = lazy(() => import('@/pages/comercial/portal/OrderHistory'))
const ClientProfile    = lazy(() => import('@/pages/comercial/portal/ClientProfile'))
const MyFreezers       = lazy(() => import('@/pages/comercial/portal/MyFreezers'))
const SelectSucursal   = lazy(() => import('@/pages/comercial/portal/SelectSucursal'))

// Shell único de escritorio para los cuatro dominios (fase 2, 2026-09-12).
const DominioLayout       = lazy(() => import('./components/layout/DominioLayout'))
const PanelControlPage    = lazy(() => import('./pages/admin/PanelControlPage'))
const AjustesGeneralesPage = lazy(() => import('./pages/admin/AjustesGeneralesPage'))
const ResumenLogisticaPage = lazy(() => import('@/pages/logistica/despacho/ResumenLogisticaPage'))
const LogisticaDashboard  = lazy(() => import('@/pages/logistica/despacho/LogisticaDashboard'))
const UserManagement      = lazy(() => import('./pages/admin/UserManagement'))
const ClientesMapPage     = lazy(() => import('@/pages/comercial/clientes/ClientesMapPage'))
const PriceListsPage      = lazy(() => import('@/pages/comercial/precios/PriceListsPage'))
const FlotaPage           = lazy(() => import('@/pages/logistica/flota/FlotaPage'))
const VisitasPage         = lazy(() => import('@/pages/comercial/visitas/VisitasPage'))
const MonitoreoPage       = lazy(() => import('@/pages/logistica/despacho/MonitoreoPage'))
const ReporteIncidenciasPage = lazy(() => import('@/pages/logistica/flota/ReporteIncidenciasPage'))
const HistorialDespachoPage  = lazy(() => import('@/pages/logistica/despacho/HistorialDespachoPage'))
const ClimaPage           = lazy(() => import('@/pages/logistica/flota/ClimaPage'))
// Lazy con doble motivo: además del peso normal, arrastra pdfjs-dist (448K).
const RecuperoFacturasPage = lazy(() => import('@/pages/comercial/facturacion/RecuperoFacturasPage'))
const ComprobantesClientesPage = lazy(() => import('@/pages/comercial/facturacion/ComprobantesClientesPage'))

const ComercialDashboard   = lazy(() => import('./pages/comercial/ComercialDashboard'))
const ComercialOrders      = lazy(() => import('./pages/comercial/ComercialOrders'))
const ReportePreciosPage   = lazy(() => import('@/pages/comercial/precios/ReportePreciosPage'))
const ReporteVentasPage    = lazy(() => import('./pages/comercial/ReporteVentasPage'))
const MapaLivePage         = lazy(() => import('@/pages/logistica/despacho/MapaLivePage'))
const HistorialPage        = lazy(() => import('@/pages/logistica/flota/HistorialPage'))

const ChoferDashboard   = lazy(() => import('@/pages/logistica/chofer/ChoferDashboard'))
const ChoferMap         = lazy(() => import('@/pages/logistica/chofer/ChoferMap'))
const VentaCamion       = lazy(() => import('@/pages/logistica/chofer/VentaCamion'))
const EntregarPedidoPage = lazy(() => import('@/pages/logistica/chofer/EntregarPedidoPage'))
const VentasChofer      = lazy(() => import('@/pages/logistica/chofer/VentasChofer'))
const GerenteDashboard  = lazy(() => import('@/pages/admin/GerenteDashboard'))

const HeladerasPage        = lazy(() => import('./pages/heladeras/HeladerasPage'))
const HeladerasEntryPage   = lazy(() => import('./pages/heladeras/HeladerasEntryPage'))
const ModelosHeladeraPage  = lazy(() => import('./pages/heladeras/ModelosHeladeraPage'))
const CatalogosServicePage = lazy(() => import('./pages/heladeras/CatalogosServicePage'))
const TecnicosPage         = lazy(() => import('./pages/heladeras/TecnicosPage'))
const TecnicoDashboard     = lazy(() => import('./pages/heladeras/TecnicoDashboard'))
const EquiposPage          = lazy(() => import('./pages/heladeras/EquiposPage'))
const EtiquetaHeladeraPage = lazy(() => import('./pages/heladeras/EtiquetaHeladeraPage'))
const FichaHeladeraPage    = lazy(() => import('./pages/heladeras/FichaHeladeraPage'))
const AsignacionEquiposPage = lazy(() => import('./pages/heladeras/AsignacionEquiposPage'))
const TomaServicePage       = lazy(() => import('./pages/heladeras/TomaServicePage'))
const ConsultaServicePage   = lazy(() => import('./pages/heladeras/ConsultaServicePage'))
const RankingConsumoPage    = lazy(() => import('./pages/heladeras/RankingConsumoPage'))
const InformesDashboardPage = lazy(() => import('./pages/heladeras/InformesDashboardPage'))
const MapaClientesHeladerasPage = lazy(() => import('./pages/heladeras/MapaClientesHeladerasPage'))
const PanolPage             = lazy(() => import('./pages/heladeras/PanolPage'))

const CalculadoraHielo  = lazy(() => import('./pages/public/CalculadoraHielo'))
const TurnosVentanillaPage = lazy(() => import('./pages/public/TurnosVentanillaPage'))

const LoginProduccion         = lazy(() => import('./pages/auth/LoginProduccion'))
const ProduccionDashboard     = lazy(() => import('@/pages/logistica/produccion/ProduccionDashboard'))
const ProduccionTicketPage    = lazy(() => import('@/pages/logistica/produccion/ProduccionTicketPage'))
const FichaPalletPage         = lazy(() => import('@/pages/logistica/produccion/FichaPalletPage'))
const ProduccionListadoPage   = lazy(() => import('@/pages/logistica/produccion/ProduccionListadoPage'))
const OperariosProduccionPage = lazy(() => import('@/pages/logistica/produccion/OperariosProduccionPage'))
const ProduccionResumenPage   = lazy(() => import('@/pages/logistica/produccion/ProduccionResumenPage'))
const PlantasProduccionPage   = lazy(() => import('@/pages/logistica/produccion/PlantasProduccionPage'))
const MaquinistaDashboard     = lazy(() => import('@/pages/logistica/produccion/MaquinistaDashboard'))
const PartesMaquinasPage      = lazy(() => import('@/pages/logistica/produccion/PartesMaquinasPage'))

const RemitosCargaPage  = lazy(() => import('@/pages/logistica/expedicion/RemitosCargaPage'))
const LiquidacionesPage = lazy(() => import('@/pages/logistica/expedicion/LiquidacionesPage'))
const LiquidacionesHistorialPage = lazy(() => import('@/pages/logistica/expedicion/LiquidacionesHistorialPage'))
const VentanillaPage    = lazy(() => import('@/pages/logistica/expedicion/VentanillaPage'))
const CobranzasPage     = lazy(() => import('@/pages/logistica/expedicion/CobranzasPage'))
const RendicionesPage   = lazy(() => import('@/pages/logistica/expedicion/RendicionesPage'))
const EntregasPage      = lazy(() => import('@/pages/logistica/expedicion/EntregasPage'))
const EntregasTesoreriaPage = lazy(() => import('@/pages/logistica/tesoreria/EntregasTesoreriaPage'))
const AnulacionesPage   = lazy(() => import('./pages/admin/AnulacionesPage'))
const RendicionesHistorialPage = lazy(() => import('@/pages/logistica/expedicion/RendicionesHistorialPage'))
const TesoreriaLivePage        = lazy(() => import('@/pages/logistica/tesoreria/TesoreriaLivePage'))
const RendicionesTesoreriaPage = lazy(() => import('@/pages/logistica/tesoreria/RendicionesTesoreriaPage'))
const MuelleDashboard    = lazy(() => import('@/pages/logistica/expedicion/MuelleDashboard'))
const MuelleTvPage       = lazy(() => import('@/pages/logistica/expedicion/MuelleTvPage'))
const SeguridadDashboard = lazy(() => import('@/pages/logistica/expedicion/SeguridadDashboard'))
const CobranzaCalle      = lazy(() => import('@/pages/logistica/chofer/CobranzaCalle'))

const SupervisorHome         = lazy(() => import('@/pages/comercial/supervisor/SupervisorHome'))
const SupervisorClientesPage = lazy(() => import('@/pages/comercial/supervisor/SupervisorClientesPage'))
const CobranzaSupervisorPage = lazy(() => import('@/pages/comercial/supervisor/CobranzaSupervisorPage'))
const SupervisorHistorialPage = lazy(() => import('@/pages/comercial/supervisor/SupervisorHistorialPage'))
const RepartoEnVivoPage       = lazy(() => import('@/pages/comercial/supervisor/RepartoEnVivoPage'))
const SupervisorBuscarPage    = lazy(() => import('@/pages/comercial/supervisor/SupervisorBuscarPage'))
const FichaClientePage        = lazy(() => import('@/pages/comercial/supervisor/FichaClientePage'))

// /caja aterriza en la primera pestaña PERMITIDA del usuario, no siempre en
// Remitos: una tablet de mostrador con las pestañas recortadas a solo
// Cobranzas (Usuarios → Permisos) tiene que caer directo ahí.
function CajaEntry() {
  const { user } = useAuth()
  // El puesto de caja quedó repartido en dos dominios (2026-09-12): el remito
  // de carga es Logística y la plata es Tesorería. Se busca primero la salida
  // del camión, que es donde arrancaba el día, y si esa tablet la tiene
  // recortada (la de solo Cobranzas, por ejemplo) se cae al circuito de plata.
  const destino = primerAccesoDe('logistica', 'expedicion', user)
    ?? primerAccesoDe('tesoreria', 'caja', user)
    ?? '/caja/remitos'
  return <Navigate to={destino} replace />
}

// /produccion es el home de todo rol produccion_hielo, pero el puesto define
// la pantalla: subrol 'maquinista' → parte de máquinas; sin subrol → carga de
// pallets. Mismo login por legajo para los dos (LoginProduccion).
function ProduccionEntry() {
  const { user } = useAuth()
  return user?.subrol === 'maquinista' ? <MaquinistaDashboard /> : <ProduccionDashboard />
}

// ── ErrorBoundary ─────────────────────────────────────────────────────────────

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack, boundary: 'root' })
    // Chunk stale tras nuevo deploy → recargar automáticamente una vez
    const isChunkError = error.message?.includes('Failed to fetch dynamically imported module')
      || error.message?.includes('Importing a module script failed')
      || error.name === 'ChunkLoadError'
    if (isChunkError && !sessionStorage.getItem('chunk-reload')) {
      sessionStorage.setItem('chunk-reload', '1')
      window.location.reload()
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#F8F7F2', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ maxWidth: '480px', background: '#ffffff', border: '1px solid #D3D1C7', borderRadius: '12px', padding: '32px', color: '#111827' }}>
            <p style={{ fontSize: '22px', fontWeight: 700, color: '#1D9E75', marginBottom: '8px' }}>Rolito</p>
            <p style={{ fontWeight: 600, marginBottom: '12px' }}>Algo salió mal</p>
            <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '20px' }}>
              {(this.state.error as Error).message}
            </p>
            <p style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '20px' }}>build {APP_RELEASE}</p>
            <button
              onClick={() => { sessionStorage.removeItem('chunk-reload'); this.setState({ error: null }); window.location.href = '/' }}
              style={{ background: '#1D9E75', color: '#ffffff', fontWeight: 700, padding: '10px 24px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
            >
              Volver al inicio
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ── ClientBranchGuard ─────────────────────────────────────────────────────────

function ClientBranchGuard() {
  const { needsSelection } = useBranch()
  if (needsSelection) return <Navigate to="/sucursal" replace />
  return <Outlet />
}

// ── AppContent ────────────────────────────────────────────────────────────────

function AppContent() {
  const { isInitializing, user } = useAuth()
  if (isInitializing) return <LoadingSpinner fullScreen />
  // Pestaña "Ver como usuario" sin sesión: el token venció o se cerró la vista.
  if (SESION_VER_COMO && !user) return <VerComoTerminada />
  return (
    <Suspense fallback={<LoadingSpinner fullScreen />}>
      {/* Banner de "Ver como": arriba de todos los layouts (ver VerComoBanner). */}
      <VerComoBanner />
      <Routes>
        {/* Rutas públicas */}
        <Route path="/"                element={<Landing />} />
        <Route path="/clientes"        element={<LoginClientes />} />
        <Route path="/empresa"         element={<LoginEmpresa />} />
        <Route path="/choferes"        element={<LoginChofer />} />
        <Route path="/tecnicos"        element={<LoginTecnico />} />
        {/* Una URL fija por planta física (no "/planta" genérico) — cada
            tablet de planta guarda la suya. LoginProduccion valida que el
            legajo ingresado pertenezca a ESA planta y rechaza (con logout)
            si no, para que un legajo tipeado de la otra planta no atribuya
            mal la producción. */}
        <Route path="/produccion-torcuato" element={<LoginProduccion planta="torcuato" />} />
        <Route path="/produccion-merlo"    element={<LoginProduccion planta="merlo" />} />
        {/* Compat: la ruta vieja "/planta" (login de operario pre-split, cuando
            había una sola planta) — una tablet con ese bookmark/PWA anclada la
            mandamos al login de Don Torcuato (única planta con operarios hoy),
            en vez de al landing genérico de clientes donde no hay forma de
            llegar a producción. */}
        <Route path="/planta"          element={<Navigate to="/produccion-torcuato" replace />} />
        <Route path="/login"           element={<Navigate to="/clientes" replace />} />
        <Route path="/register"        element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/pendiente"       element={<PendingApproval />} />
        <Route path="/calculadora-rolito" element={<CalculadoraHielo />} />
        {/* Turnos de ventanilla — pública, la abre el QR del comprobante
            (sesión anónima; solo lee el tablero sanitizado turnosPublicos). */}
        <Route path="/turnos/:plantaId" element={<TurnosVentanillaPage />} />

        {/* Cliente */}
        <Route element={<ProtectedRoute allowedRoles={rolesDe('/sucursal')} />}>
          <Route path="/sucursal" element={<SelectSucursal />} />
          {/* Mis heladeras: no depende de sucursal (clienteAsignadoId es por
              cliente, no por dirección), por eso queda afuera de ClientBranchGuard. */}
          <Route path="/mis-heladeras" element={<MyFreezers />} />
          <Route element={<ClientBranchGuard />}>
            <Route path="/dashboard"    element={<ClientDashboard />} />
            <Route path="/nuevo-pedido" element={<NewOrder />} />
            <Route path="/historial"    element={<OrderHistory />} />
            <Route path="/perfil"       element={<ClientProfile />} />
          </Route>
        </Route>

        {/* ── Escritorio: un solo shell para los cuatro dominios (Logística,
            Heladeras, Comercial, Administración). DominioLayout elige el
            sidebar por el dominio activo y la ruta — ver src/rutas/catalogo.ts.
            Los roles de cada bloque salen del catálogo (rolesDe); un bloque
            toma los de su primera ruta. ── */}
        <Route element={<DominioLayout />}>

          {/* Logística: despacho y rutas */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/logistica/resumen')} />}>
            <Route path="/logistica/resumen"        element={<ResumenLogisticaPage />} />
            <Route path="/logistica"                element={<LogisticaDashboard />} />
            {/* Alias viejo sin ningún link en el código (fase 0, 2026-09-12): redirige a la ruta canónica. */}
            <Route path="/admin/planificacion"      element={<Navigate to="/logistica" replace />} />
            <Route path="/admin/historial-despacho" element={<HistorialDespachoPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/admin/monitoreo')} />}>
            <Route path="/admin/monitoreo" element={<MonitoreoPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/comercial/mapa')} />}>
            <Route path="/comercial/mapa" element={<MapaLivePage />} />
          </Route>

          {/* Logística: operaciones y flota */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/admin/flota')} />}>
            <Route path="/admin/flota"       element={<FlotaPage />} />
            <Route path="/admin/incidencias" element={<ReporteIncidenciasPage />} />
          </Route>
          {/* Historial unificado */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/movimientos')} />}>
            <Route path="/movimientos" element={<HistorialPage />} />
          </Route>
          {/* Clima es solo lectura: comercial también entra (linkeado desde su tablero) */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/admin/clima')} />}>
            <Route path="/admin/clima" element={<ClimaPage />} />
          </Route>

          {/* Logística: planta y expedición — rol 'caja' (fijo por planta) */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/caja')} />}>
            <Route path="/caja"                element={<CajaEntry />} />
            <Route path="/caja/remitos"        element={<RemitosCargaPage />} />
            <Route path="/caja/ventanilla"     element={<VentanillaPage />} />
            <Route path="/caja/cobranzas"      element={<CobranzasPage />} />
            <Route path="/caja/liquidaciones"  element={<LiquidacionesPage base="/caja" />} />
            {/* Cierre de caja por persona y día (2026-09-09). */}
            <Route path="/caja/rendiciones"    element={<RendicionesPage />} />
            {/* Entrega de caja a tesorería con acta y doble firma (2026-09-09). */}
            <Route path="/caja/entregas"       element={<EntregasPage />} />
          </Route>
          {/* Historial de cierres: también gerencia (control de faltantes por repartidor). */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/caja/liquidaciones/historial')} />}>
            <Route path="/caja/liquidaciones/historial" element={<LiquidacionesHistorialPage base="/caja" />} />
            <Route path="/caja/rendiciones/historial"   element={<RendicionesHistorialPage enTesoreria={false} />} />
          </Route>

          {/* Logística: producción de hielo — panel del encargado; Listado es
              compartido con gerencia / logística / comercial (mismo shell). */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/produccion/resumen')} />}>
            <Route path="/produccion/resumen"   element={<ProduccionResumenPage />} />
            <Route path="/produccion/partes"    element={<PartesMaquinasPage />} />
            <Route path="/produccion/operarios" element={<OperariosProduccionPage />} />
            <Route path="/produccion/plantas"   element={<PlantasProduccionPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/produccion/listado')} />}>
            <Route path="/produccion/listado" element={<ProduccionListadoPage />} />
          </Route>

          {/* Logística: tesorería (rol propio, 2026-09-09). Gerencia general entra en modo lectura. */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/tesoreria')} />}>
            <Route path="/tesoreria"                       element={<TesoreriaLivePage />} />
            <Route path="/tesoreria/rendiciones"           element={<RendicionesTesoreriaPage />} />
            <Route path="/tesoreria/rendiciones/historial" element={<RendicionesHistorialPage enTesoreria />} />
            {/* Entregas de caja: tesorería cuenta, tilda los valores y firma (2026-09-09). */}
            <Route path="/tesoreria/entregas"              element={<EntregasTesoreriaPage />} />
            <Route path="/tesoreria/anulaciones"           element={<AnulacionesPage />} />
            {/* La liquidación del repartidor con todo el detalle, en modo lectura (a tesorería le rinden). */}
            <Route path="/tesoreria/liquidaciones"           element={<LiquidacionesPage base="/tesoreria" />} />
            <Route path="/tesoreria/liquidaciones/historial" element={<LiquidacionesHistorialPage base="/tesoreria" />} />
          </Route>

          {/* Heladeras (las vistas standalone — etiqueta, ficha, técnico — van más abajo) */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/heladeras')} />}>
            <Route path="/heladeras" element={<HeladerasEntryPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/heladeras/taller')} />}>
            <Route path="/heladeras/taller" element={<HeladerasPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/heladeras/modelos')} />}>
            <Route path="/heladeras/modelos"   element={<ModelosHeladeraPage />} />
            <Route path="/heladeras/catalogos" element={<CatalogosServicePage />} />
            <Route path="/heladeras/tecnicos"  element={<TecnicosPage />} />
            <Route path="/heladeras/equipos"   element={<EquiposPage />} />
            <Route path="/heladeras/panol"     element={<PanolPage />} />
          </Route>
          {/* Informes y Mapa: también gerente_general, como drill-down de solo
              lectura desde el link "Ver informes" del panel de directores. */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/heladeras/informes')} />}>
            <Route path="/heladeras/informes" element={<InformesDashboardPage />} />
            <Route path="/heladeras/mapa"     element={<MapaClientesHeladerasPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/heladeras/asignacion')} />}>
            <Route path="/heladeras/asignacion" element={<AsignacionEquiposPage />} />
            <Route path="/heladeras/ranking"    element={<RankingConsumoPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/heladeras/consulta-service')} />}>
            <Route path="/heladeras/consulta-service" element={<ConsultaServicePage />} />
            <Route path="/heladeras/toma-service"     element={<TomaServicePage />} />
          </Route>

          {/* Comercial */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/comercial')} />}>
            <Route path="/comercial"         element={<ComercialDashboard />} />
            <Route path="/comercial/pedidos" element={<ComercialOrders />} />
          </Route>
          {/* Reportes */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/comercial/reporte-precios')} />}>
            <Route path="/comercial/reporte-precios" element={<ReportePreciosPage />} />
            <Route path="/comercial/ventas"          element={<ReporteVentasPage />} />
          </Route>
          {/* Clientes (CRM, operativo) y Usuarios / equipo interno (solo
              super_admin, más abajo) son dos entradas que renderizan el mismo
              componente; la vista la fija la prop `tab`. */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/usuarios')} />}>
            <Route path="/usuarios"            element={<UserManagement tab="clientes" />} />
            <Route path="/admin/mapa-clientes" element={<ClientesMapPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/admin/visitas')} />}>
            <Route path="/admin/visitas" element={<VisitasPage />} />
          </Route>
          {/* Precios (catálogo + listas): super_admin, logística, comercial y gerente comercial */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/admin/precios')} />}>
            <Route path="/admin/precios" element={<PriceListsPage />} />
          </Route>
          {/* Comprobantes de clientes (2026-09-10) y recupero de facturas viejas (campaña puntual). */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/admin/comprobantes')} />}>
            <Route path="/admin/comprobantes"      element={<ComprobantesClientesPage />} />
            <Route path="/admin/recupero-facturas" element={<RecuperoFacturasPage />} />
          </Route>
          {/* Anulaciones de facturas (2026-09-09): la bandeja la abre cualquier
              staff de oficina; aprobar exige users.autorizaAnulaciones. */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/anulaciones')} />}>
            <Route path="/anulaciones" element={<AnulacionesPage />} />
          </Route>

          {/* Administración y gerencia */}
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/gerente')} />}>
            <Route path="/gerente" element={<GerenteDashboard />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={rolesDe('/admin')} />}>
            <Route path="/admin"          element={<PanelControlPage />} />
            <Route path="/admin/usuarios" element={<UserManagement tab="equipo" />} />
            <Route path="/admin/general"  element={<AjustesGeneralesPage />} />
          </Route>
        </Route>

        {/* Chofer */}
        <Route element={<ProtectedRoute allowedRoles={rolesDe('/chofer')} />}>
          <Route path="/chofer"        element={<ChoferDashboard />} />
          <Route path="/chofer/map"    element={<ChoferMap />} />
          <Route path="/chofer/venta"  element={<VentaCamion />} />
          <Route path="/chofer/entregar/:orderId" element={<EntregarPedidoPage />} />
          <Route path="/chofer/ventas" element={<VentasChofer />} />
          <Route path="/chofer/cobrar" element={<CobranzaCalle />} />
        </Route>

        {/* Selección de dominio: cualquier usuario activo. Sin lista de roles:
            con una lista fija, un usuario con rol adicional caía en un loop
            / → /sistema → / y veía la pantalla en blanco (Lucas, 2026-09-09).
            Quien tiene un solo dominio es redirigido a su home por la propia página. */}
        <Route element={<ProtectedRoute />}>
          <Route path="/sistema" element={<SeleccionSistemaPage />} />
        </Route>

        {/* Heladeras: vistas standalone / print y el técnico de calle */}
        <Route element={<ProtectedRoute allowedRoles={rolesDe('/heladeras/etiqueta/:heladeraId')} />}>
          <Route path="/heladeras/etiqueta/:heladeraId" element={<EtiquetaHeladeraPage />} />
        </Route>
        <Route element={<ProtectedRoute allowedRoles={rolesDe('/tecnico')} />}>
          <Route path="/tecnico" element={<TecnicoDashboard />} />
        </Route>
        {/* Ficha pública (dentro de la app) de una heladera — destino del QR de la etiqueta */}
        <Route element={<ProtectedRoute allowedRoles={rolesDe('/heladeras/ficha/:heladeraId')} />}>
          <Route path="/heladeras/ficha/:heladeraId" element={<FichaHeladeraPage />} />
        </Route>

        {/* Producción de hielo — dashboard de carga (tablet en planta), fuera
            de cualquier layout, mismo criterio que /tecnico. */}
        <Route element={<ProtectedRoute allowedRoles={rolesDe('/produccion')} />}>
          <Route path="/produccion" element={<ProduccionEntry />} />
        </Route>
        {/* Ticket (impresión standalone) y ficha de consulta de un pallet */}
        <Route element={<ProtectedRoute allowedRoles={rolesDe('/produccion/ticket/:palletId')} />}>
          <Route path="/produccion/ticket/:palletId" element={<ProduccionTicketPage />} />
          <Route path="/produccion/ficha/:palletId"  element={<FichaPalletPage />} />
        </Route>

        {/* Muelle — tablet en planta, Navbar genérico (una sola pantalla):
            entrega la carga contra el remito y cuenta la descarga al volver. */}
        <Route element={<ProtectedRoute allowedRoles={rolesDe('/muelle')} />}>
          <Route path="/muelle"    element={<MuelleDashboard />} />
          {/* TV en kiosco del muelle: solo lectura, tipografía gigante. */}
          <Route path="/muelle/tv" element={<MuelleTvPage />} />
        </Route>

        {/* Seguridad — celular/tablet en el portón: control de salidas. */}
        <Route element={<ProtectedRoute allowedRoles={rolesDe('/seguridad')} />}>
          <Route path="/seguridad" element={<SeguridadDashboard />} />
        </Route>

        {/* Supervisor — cobranzas de cta. cte. en la calle (celular): saldos
            de Tango, imputación de facturas, cheques y retenciones. */}
        <Route element={<ProtectedRoute allowedRoles={rolesDe('/supervisor')} />}>
          <Route path="/supervisor"          element={<SupervisorHome />} />
          <Route path="/supervisor/clientes" element={<SupervisorClientesPage />} />
          <Route path="/supervisor/cobrar"   element={<CobranzaSupervisorPage />} />
          <Route path="/supervisor/historial" element={<SupervisorHistorialPage />} />
          <Route path="/supervisor/reparto"   element={<RepartoEnVivoPage />} />
          {/* Ficha del cliente en la calle: buscador + datos, contacto,
              domicilios (ir con Maps) y saldo con composición para compartir. */}
          <Route path="/supervisor/buscar"       element={<SupervisorBuscarPage />} />
          <Route path="/supervisor/cliente/:uid" element={<FichaClientePage />} />
          {/* Los supervisores también entregan (son depósitos en Tango): venden
              con las mismas pantallas del chofer, que vuelven a /supervisor. */}
          <Route path="/supervisor/vender"    element={<VentaCamion volverA="/supervisor" />} />
          <Route path="/supervisor/ventas"    element={<VentasChofer volverA="/supervisor" />} />
        </Route>

        {/* Cualquier otra ruta */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            5 * 60_000,
      retry:                1,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SistemaProvider>
            <BranchProvider>
              <BrowserRouter>
                <AppContent />
              </BrowserRouter>
            </BranchProvider>
          </SistemaProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
