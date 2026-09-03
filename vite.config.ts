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

export default defineConfig({
  define: {
    __APP_RELEASE__: JSON.stringify(resolveRelease()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          maps:     ['@react-google-maps/api'],
          router:   ['react-router-dom'],
          charts:   ['recharts'],
          pdf:      ['jspdf', 'jspdf-autotable'],
          pdfjs:    ['pdfjs-dist'],
          dnd:      ['@dnd-kit/core', '@dnd-kit/utilities'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  plugins: [
    react(),
    VitePWA({
      strategies:   'injectManifest',
      srcDir:       'src',
      filename:     'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'apple-touch-icon.png'],
      injectManifest: {
        // Los chunks pesados de uso puntual (Excel, PDF, reportes, pañol) no
        // se precachean en el install del SW — la mayoría de los roles nunca
        // los visita, y precachearlos igual compite por ancho de banda con la
        // carga real en conexiones intermitentes. Se cachean en runtime
        // (StaleWhileRevalidate, ver src/sw.ts) recién cuando se usan.
        globIgnores: [
          '**/xlsx-*.js',
          '**/pdfjs-*.js',
          '**/pdf-*.js',
          '**/PanolPage-*.js',
          '**/charts-*.js',
          '**/html2canvas*.js',
          '**/BarcodeScanner-*.js',
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
