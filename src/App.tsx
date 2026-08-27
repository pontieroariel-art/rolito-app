import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { BranchProvider, useBranch } from './context/BranchContext'
import { SistemaProvider } from './context/SistemaContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoadingSpinner from './components/ui/LoadingSpinner'
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
const ClientDashboard  = lazy(() => import('./pages/client/ClientDashboard'))
const NewOrder         = lazy(() => import('./pages/client/NewOrder'))
const OrderHistory     = lazy(() => import('./pages/client/OrderHistory'))
const ClientProfile    = lazy(() => import('./pages/client/ClientProfile'))
const MyFreezers       = lazy(() => import('./pages/client/MyFreezers'))
const SelectSucursal   = lazy(() => import('./pages/client/SelectSucursal'))

const LogisticaLayout     = lazy(() => import('./components/layout/LogisticaLayout'))
const BackofficeLayout    = lazy(() => import('./components/layout/BackofficeLayout'))
const BackofficeHome      = lazy(() => import('./pages/admin/BackofficeHome'))
const AjustesGeneralesPage = lazy(() => import('./pages/admin/AjustesGeneralesPage'))
const ResumenLogisticaPage = lazy(() => import('./pages/logistica/ResumenLogisticaPage'))
const LogisticaDashboard  = lazy(() => import('./pages/admin/LogisticaDashboard'))
const UserManagement      = lazy(() => import('./pages/admin/UserManagement'))
const ClientesMapPage     = lazy(() => import('./pages/admin/ClientesMapPage'))
const PriceListsPage      = lazy(() => import('./pages/admin/PriceListsPage'))
const FlotaPage           = lazy(() => import('./pages/admin/FlotaPage'))
const VisitasPage         = lazy(() => import('./pages/admin/VisitasPage'))
const MonitoreoPage       = lazy(() => import('./pages/admin/MonitoreoPage'))
const ReporteIncidenciasPage = lazy(() => import('./pages/admin/ReporteIncidenciasPage'))
const HistorialDespachoPage  = lazy(() => import('./pages/admin/HistorialDespachoPage'))
const ClimaPage           = lazy(() => import('./pages/admin/ClimaPage'))

const ComercialDashboard   = lazy(() => import('./pages/comercial/ComercialDashboard'))
const ComercialOrders      = lazy(() => import('./pages/comercial/ComercialOrders'))
const ReportePreciosPage   = lazy(() => import('./pages/comercial/ReportePreciosPage'))
const ReporteVentasPage    = lazy(() => import('./pages/comercial/ReporteVentasPage'))
const HistorialPreciosPage = lazy(() => import('./pages/comercial/HistorialPreciosPage'))
const MapaLivePage         = lazy(() => import('./pages/comercial/MapaLivePage'))
const HistorialPage        = lazy(() => import('./pages/shared/HistorialPage'))

const ChoferDashboard   = lazy(() => import('./pages/chofer/ChoferDashboard'))
const ChoferMap         = lazy(() => import('./pages/chofer/ChoferMap'))
const GerenteDashboard  = lazy(() => import('./pages/gerente/GerenteDashboard'))

const HeladerasLayout      = lazy(() => import('./components/heladeras/HeladerasLayout'))
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

const LoginProduccion         = lazy(() => import('./pages/auth/LoginProduccion'))
const ProduccionLayout        = lazy(() => import('./components/produccion/ProduccionLayout'))
const ProduccionDashboard     = lazy(() => import('./pages/produccion/ProduccionDashboard'))
const ProduccionTicketPage    = lazy(() => import('./pages/produccion/ProduccionTicketPage'))
const FichaPalletPage         = lazy(() => import('./pages/produccion/FichaPalletPage'))
const ProduccionListadoPage   = lazy(() => import('./pages/produccion/ProduccionListadoPage'))
const OperariosProduccionPage = lazy(() => import('./pages/produccion/OperariosProduccionPage'))

// ── ErrorBoundary ─────────────────────────────────────────────────────────────

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Error no capturado:', error, info.componentStack)
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
  const { isInitializing } = useAuth()
  if (isInitializing) return <LoadingSpinner fullScreen />
  return (
    <Suspense fallback={<LoadingSpinner fullScreen />}>
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

        {/* Cliente */}
        <Route element={<ProtectedRoute allowedRoles={['cliente']} />}>
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

        {/* Sistema logística/oficina — LogisticaLayout agrega el sidebar del
            sistema (sin Navbar arriba, ver src/components/layout/LogisticaLayout.tsx). */}
        <Route element={<LogisticaLayout />}>
          {/* Logística — el resumen de KPIs (ex /admin, ex AdminDashboard)
              ya no es cosa de super_admin: super_admin administra desde el
              Backoffice (ver bloque BackofficeLayout más abajo). */}
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica', 'gerente_comercial']} />}>
            <Route path="/logistica/resumen"    element={<ResumenLogisticaPage />} />
          </Route>
          {/* Flota es config compartida (ver plan de migración del
              Backoffice) — super_admin la conserva. Visitas e Incidencias
              son operativas del día a día: ya no. */}
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica']} />}>
            <Route path="/admin/flota"          element={<FlotaPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica']} />}>
            <Route path="/admin/visitas"        element={<VisitasPage />} />
            <Route path="/admin/incidencias"    element={<ReporteIncidenciasPage />} />
          </Route>
          {/* Precios (catálogo + listas): super_admin, logística, comercial y gerente comercial */}
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica', 'comercial', 'gerente_comercial']} />}>
            <Route path="/admin/precios"        element={<PriceListsPage />} />
          </Route>
          {/* Tablero de despacho e historial — operativo, ya no super_admin */}
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica', 'gerente_comercial']} />}>
            <Route path="/logistica"              element={<LogisticaDashboard />} />
            <Route path="/admin/planificacion"    element={<LogisticaDashboard />} />
            <Route path="/admin/historial-despacho" element={<HistorialDespachoPage />} />
          </Route>
          {/* Clima es solo lectura: comercial también entra (linkeado desde su tablero) */}
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica', 'gerente_comercial', 'comercial']} />}>
            <Route path="/admin/clima"         element={<ClimaPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'logistica', 'gerente_general', 'gerente_comercial']} />}>
            <Route path="/admin/monitoreo" element={<MonitoreoPage />} />
          </Route>

          {/* Gerente general — super_admin entra en solo lectura, mismo dato que ya
              puede leer desde el Backoffice, solo que resumido (ver BackofficeHome). */}
          <Route element={<ProtectedRoute allowedRoles={['gerente_general', 'super_admin']} />}>
            <Route path="/gerente" element={<GerenteDashboard />} />
          </Route>

          {/* Gestión de usuarios — Clientes (CRM, operativo, todos los roles
              de abajo) y Usuarios/equipo interno (ABM de staff + roles, ver
              /admin/usuarios en el Backoffice) son dos entradas separadas
              que renderizan el mismo componente. */}
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion', 'logistica']} />}>
            <Route path="/usuarios" element={<UserManagement />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion', 'logistica']} />}>
            <Route path="/admin/mapa-clientes" element={<ClientesMapPage />} />
          </Route>

          {/* Comercial */}
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'comercial']} />}>
            <Route path="/comercial"         element={<ComercialDashboard />} />
            <Route path="/comercial/pedidos" element={<ComercialOrders />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'comercial', 'logistica']} />}>
            <Route path="/comercial/mapa" element={<MapaLivePage />} />
          </Route>

          {/* Reportes */}
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion']} />}>
            <Route path="/comercial/reporte-precios"  element={<ReportePreciosPage />} />
            <Route path="/comercial/ventas"           element={<ReporteVentasPage />} />
          </Route>

          {/* Historial de precios */}
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'logistica', 'facturacion']} />}>
            <Route path="/comercial/historial-precios" element={<HistorialPreciosPage />} />
          </Route>

          {/* Historial unificado */}
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'comercial', 'facturacion']} />}>
            <Route path="/movimientos" element={<HistorialPage />} />
          </Route>
        </Route>

        {/* Chofer */}
        <Route element={<ProtectedRoute allowedRoles={['chofer']} />}>
          <Route path="/chofer"     element={<ChoferDashboard />} />
          <Route path="/chofer/map" element={<ChoferMap />} />
        </Route>

        {/* Selección de sistema (roles con acceso a más de uno, ver src/utils/sistemas.ts).
            super_admin no entra acá — no opera ningún sistema, administra
            desde /admin sin picker. */}
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'gerente_comercial', 'comercial']} />}>
          <Route path="/sistema" element={<SeleccionSistemaPage />} />
        </Route>

        {/* Heladeras — HeladerasLayout agrega Navbar + sidebar del módulo.
            Quedan afuera /heladeras/etiqueta y /heladeras/ficha (vistas
            standalone/print) y /tecnico (vista simplificada, no forma parte
            del hub). */}
        <Route element={<HeladerasLayout />}>
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'heladeras', 'heladeras_encargado', 'gerente_comercial', 'comercial']} />}>
            <Route path="/heladeras" element={<HeladerasEntryPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'heladeras', 'heladeras_encargado', 'gerente_comercial']} />}>
            <Route path="/heladeras/taller" element={<HeladerasPage />} />
          </Route>
          {/* Modelos, Catálogos, Técnicos, Padrón de equipos y Pañol son
              config/maestro compartido (ver plan de migración del
              Backoffice) — super_admin los conserva. */}
          <Route element={<ProtectedRoute allowedRoles={['heladeras_encargado', 'super_admin', 'gerente_comercial']} />}>
            <Route path="/heladeras/modelos"   element={<ModelosHeladeraPage />} />
            <Route path="/heladeras/catalogos" element={<CatalogosServicePage />} />
            <Route path="/heladeras/tecnicos"  element={<TecnicosPage />} />
            <Route path="/heladeras/equipos"   element={<EquiposPage />} />
            <Route path="/heladeras/panol"     element={<PanolPage />} />
          </Route>
          {/* Informes y Mapa son reporte/monitoreo, no config — sin nav propio para
              super_admin (vive en Backoffice), pero sí alcanzable como drill-down de
              solo lectura desde el link "Ver informes →" del Panel de directores
              (/gerente, accesible por gerente_general y super_admin). */}
          <Route element={<ProtectedRoute allowedRoles={['heladeras_encargado', 'gerente_comercial', 'gerente_general', 'super_admin']} />}>
            <Route path="/heladeras/informes"  element={<InformesDashboardPage />} />
            <Route path="/heladeras/mapa"      element={<MapaClientesHeladerasPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'heladeras_encargado', 'gerente_comercial', 'comercial']} />}>
            <Route path="/heladeras/asignacion" element={<AsignacionEquiposPage />} />
            <Route path="/heladeras/ranking"    element={<RankingConsumoPage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'heladeras_encargado', 'gerente_comercial']} />}>
            <Route path="/heladeras/consulta-service" element={<ConsultaServicePage />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'heladeras_encargado', 'gerente_comercial']} />}>
            <Route path="/heladeras/toma-service" element={<TomaServicePage />} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'heladeras_encargado', 'gerente_comercial']} />}>
          <Route path="/heladeras/etiqueta/:heladeraId" element={<EtiquetaHeladeraPage />} />
        </Route>
        <Route element={<ProtectedRoute allowedRoles={['tecnico']} />}>
          <Route path="/tecnico" element={<TecnicoDashboard />} />
        </Route>
        {/* Ficha pública (dentro de la app) de una heladera — destino del QR de la etiqueta */}
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'heladeras', 'heladeras_encargado', 'gerente_comercial', 'comercial', 'tecnico']} />}>
          <Route path="/heladeras/ficha/:heladeraId" element={<FichaHeladeraPage />} />
        </Route>

        {/* Producción de hielo — dashboard de carga (tablet en planta), fuera
            de cualquier layout, mismo criterio que /tecnico. */}
        <Route element={<ProtectedRoute allowedRoles={['produccion_hielo']} />}>
          <Route path="/produccion" element={<ProduccionDashboard />} />
        </Route>
        {/* Ticket (impresión standalone) y ficha de consulta de un pallet */}
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'produccion_hielo', 'produccion_encargado', 'gerente_general', 'gerente_comercial', 'comercial', 'logistica']} />}>
          <Route path="/produccion/ticket/:palletId" element={<ProduccionTicketPage />} />
          <Route path="/produccion/ficha/:palletId"  element={<FichaPalletPage />} />
        </Route>
        {/* Listado de producción para gerencia/logística/encargado. super_admin
            entra también — tiene una card directa a esta ruta en el Backoffice
            (Configuración — Producción) que hasta ahora rebotaba. */}
        <Route element={<ProtectedRoute allowedRoles={['gerente_general', 'gerente_comercial', 'comercial', 'logistica', 'produccion_encargado', 'super_admin']} />}>
          <Route path="/produccion/listado" element={<ProduccionListadoPage />} />
        </Route>

        {/* Producción — panel del encargado (rol produccion_encargado), mismo
            patrón que LogisticaLayout/HeladerasLayout. Arranca con Operarios
            nada más, se va a ir sumando a medida que crezca (ver
            utils/produccionNav.ts). */}
        <Route element={<ProduccionLayout />}>
          <Route element={<ProtectedRoute allowedRoles={['produccion_encargado', 'super_admin']} />}>
            <Route path="/produccion/operarios" element={<OperariosProduccionPage />} />
          </Route>
        </Route>

        {/* Backoffice — panel de administración centralizado, exclusivo
            super_admin. BackofficeLayout agrega su propio sidebar (ver
            src/components/layout/BackofficeLayout.tsx). Las pantallas de
            configuración que además usa un rol operativo a diario (Flota,
            Modelos, Catálogos, Técnicos, Precios, Operarios de producción)
            NO viven acá — se quedan en su layout de siempre y el Backoffice
            solo linkea a ellas desde BackofficeHome. */}
        <Route element={<BackofficeLayout />}>
          <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
            <Route path="/admin"                  element={<BackofficeHome />} />
            <Route path="/admin/usuarios"         element={<UserManagement />} />
            <Route path="/admin/general"          element={<AjustesGeneralesPage />} />
          </Route>
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
