import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { execSync } from 'child_process'

// Identificador del build para Sentry (`release`): sin esto, un error en
// producción no dice de qué versión vino y no se puede saber si un fix ya lo
// tapó. En CI usa el SHA del commit que deploya (GITHUB_SHA); en local, el HEAD
// de git; si no hay git, 'local'.
function resolveRelease(): string {
  const sha = process.env.GITHUB_SHA
  if (sha) return sha.slice(0, 7)
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() }
  catch { return 'local' }
}

// La versión va en una <meta> del index.html y NO en el código con `define`
// (2026-09-25): metida en un chunk compartido cambiaba el nombre de 228 de 382
// archivos en cada deploy aunque no se tocara nada, y toda pestaña abierta con
// una pantalla sin bajar caía en "Failed to fetch dynamically imported module".
const appRelease = {
  name: 'app-release',
  transformIndexHtml: (html: string) =>
    html.replace('</head>', `  <meta name="app-release" content="${resolveRelease()}" />
  </head>`),
}

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Firestore 12 arrastra el motor RE2 (45 KB gz) para expresiones de
      // pipelines que no se usan: ver src/stubs/re2js.ts.
      re2js: path.resolve(import.meta.dirname, './src/stubs/re2js.ts'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Vite 8 empaqueta con Rolldown (2026-09-22): `manualChunks` ya no
        // sirve (dejaba react-dom adentro de `charts` y el login precargaba
        // gráficos, PDF y mapas otra vez, como antes de la auditoría del
        // 12/09). `advancedChunks` asigna cada paquete a un grupo por
        // prioridad; lo que no matchea (lucide, qrcode, date-fns…) lo parte
        // Rolldown en chunks compartidos por uso. Verificar después de tocar
        // esto que dist/index.html precargue solo vendor, router y firebase.
        advancedChunks: {
          groups: [
            { name: 'vendor',   priority: 100, test: /[\/]node_modules[\/](react|react-dom|scheduler|react-is|clsx|class-variance-authority|tailwind-merge|tslib|@babel[\/]runtime|use-sync-external-store)[\/]/ },
            { name: 'firebase', priority: 90,  test: /[\/]node_modules[\/](@firebase[\/](app|auth|firestore|util|component|logger|webchannel-wrapper)|firebase[\/](app|auth|firestore)|idb)[\/]/ },
            { name: 'router',   priority: 90,  test: /[\/]node_modules[\/](react-router|react-router-dom)[\/]/ },
            { name: 'maps',     priority: 80,  test: /[\/]node_modules[\/]@react-google-maps[\/]api[\/]/ },
            { name: 'charts',   priority: 80,  test: /[\/]node_modules[\/](recharts|react-smooth|react-transition-group|dom-helpers|victory-vendor|d3-[a-z-]+|internmap|es-toolkit|immer|@reduxjs[\/]toolkit|redux|react-redux|reselect|decimal.js-light|eventemitter3)[\/]/ },
            { name: 'pdf',      priority: 80,  test: /[\/]node_modules[\/](jspdf|jspdf-autotable|pako|fast-png|fflate|iobuffer|core-js|html2canvas|dompurify|canvg)[\/]/ },
            { name: 'pdfjs',    priority: 80,  test: /[\/]node_modules[\/]pdfjs-dist[\/]/ },
            { name: 'dnd',      priority: 80,  test: /[\/]node_modules[\/]@dnd-kit[\/]/ },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  plugins: [
    appRelease,
    react(),
    VitePWA({
      strategies:   'injectManifest',
      srcDir:       'src',
      filename:     'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'apple-touch-icon.png'],
      injectManifest: {
        // Los chunks pesados de uso puntual (Excel, lector de PDF, reportes,
        // pañol) no se precachean en el install del SW. jspdf (chunk 'pdf') SÍ
        // se precachea: el chofer arma la factura para el cliente en la calle
        // y no puede depender de haberla generado antes con señal — la mayoría de los roles nunca
        // los visita, y precachearlos igual compite por ancho de banda con la
        // carga real en conexiones intermitentes. Se cachean en runtime
        // (StaleWhileRevalidate, ver src/sw.ts) recién cuando se usan.
        globIgnores: [
          // Manuales de caja y tesorería (HTML + PDF + capturas, ~5 MB): se cargan al abrirlos.
          '**/manuales/**',
          '**/xlsx-*.js',
          '**/pdfjs-*.js',
          '**/PanolPage-*.js',
          '**/charts-*.js',
          '**/html2canvas*.js',
          // canvg, dependencia opcional de jspdf (SVG → canvas); nadie lo usa
          // en la app pero Rollup igual lo emite como chunk aparte.
          '**/index.es-*.js',
          '**/BarcodeScanner-*.js',
          // Pantallas de ESCRITORIO (oficina, gerencia, tesorería, reportes,
          // taller): no van al precache del teléfono del chofer, el supervisor
          // ni las tablets de planta (auditoría 2026-09-22: 316 JS y 3,9 MB por
          // instalación y por cada push a master). Se cachean en runtime al
          // primer uso, como los chunks pesados (ver PAGINAS_OFICINA en sw.ts).
          ...[
            'AjustesGeneralesPage',
            'AnulacionesPage',
            'AsignacionEquiposPage',
            'CatalogosServicePage',
            'ClientesMapPage',
            'ComercialDashboard',
            'ComercialOrders',
            'ComprobantesClientesPage',
            'ConsultaServicePage',
            'EquiposPage',
            'FlotaPage',
            'GerenteDashboard',
            'HistorialDespachoPage',
            'HistorialPage',
            'InformesDashboardPage',
            'LiquidacionesAbiertasPage',
            'LiquidacionesHistorialPage',
            'LogisticaDashboard',
            'MapaClientesHeladerasPage',
            'MapaLivePage',
            'MetricsDashboard',
            'ModelosHeladeraPage',
            'MonitoreoPage',
            'OperariosProduccionPage',
            'PanelControlPage',
            'PerfilStaffPage',
            'PlantasProduccionPage',
            'PriceListsPage',
            'ProduccionListadoPage',
            'ProduccionResumenPage',
            'RankingConsumoPage',
            'RecepcionPage',
            'RecuperoFacturasPage',
            'RendicionesHistorialPage',
            'ReporteIncidenciasPage',
            'ReportePreciosPage',
            'ReporteVentasPage',
            'ResumenLogisticaPage',
            'TecnicosPage',
            'TiemposMuellePage',
            'UserManagement',
            'VentasLivePage',
            'MockupMuelleTv',
            'DiagnosticoTelePage',
          ].map((n) => `**/${n}-*.js`),
        ],
      },
      manifest: {
        name: 'Rolito - Distribución de Hielo',
        short_name: 'Rolito',
        description: 'Gestión de pedidos de hielo a domicilio',
        theme_color: '#2D6A4F',
        background_color: '#2D6A4F',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
      },
    }),
  ],
})
