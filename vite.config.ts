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
        // En forma de FUNCIÓN a propósito (2026-09-12, auditoría de performance):
        // con el objeto `{ pdf: ['jspdf'], … }` Rollup metía en esos chunks
        // también los helpers que jspdf/recharts/maps comparten con el resto,
        // y el chunk inicial terminaba importando pdf (412 KB), charts (374 KB)
        // y maps (150 KB) de forma estática en el login de todos. Acá solo va
        // al chunk el código de la librería misma; lo compartido queda en el
        // chunk que corresponda por uso.
        manualChunks(id: string) {
          const ruta = id.replace(/\\/g, '/')
          // Lo que TODA la app usa (React, el helper de precarga de Vite, clsx…)
          // va a un chunk propio: si no, Rollup lo deja en el primer chunk manual
          // que lo pide (pdf, maps, charts) y el arranque los importa a todos.
          if (ruta.includes('vite/preload-helper') || ruta.includes('commonjsHelpers')) return 'vendor'
          if (!ruta.includes('node_modules')) return undefined
          const es = (...pkgs: string[]) => pkgs.some((p) => ruta.includes(`/node_modules/${p}/`))
          if (es('react', 'react-dom', 'scheduler', 'react-is', 'clsx', 'class-variance-authority', 'tailwind-merge', 'tslib', '@babel/runtime', 'use-sync-external-store')) return 'vendor'
          if (es('@react-google-maps/api')) return 'maps'
          if (es('react-router', 'react-router-dom')) return 'router'
          if (es('recharts')) return 'charts'
          if (es('jspdf', 'jspdf-autotable')) return 'pdf'
          if (es('pdfjs-dist')) return 'pdfjs'
          if (es('@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities')) return 'dnd'
          if (es('@firebase/app', '@firebase/auth', '@firebase/firestore', '@firebase/util', '@firebase/component', '@firebase/logger', '@firebase/webchannel-wrapper')
            || ruta.includes('/node_modules/firebase/app/') || ruta.includes('/node_modules/firebase/auth/') || ruta.includes('/node_modules/firebase/firestore/')) return 'firebase'
          return undefined
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
        // Los chunks pesados de uso puntual (Excel, lector de PDF, reportes,
        // pañol) no se precachean en el install del SW. jspdf (chunk 'pdf') SÍ
        // se precachea: el chofer arma la factura para el cliente en la calle
        // y no puede depender de haberla generado antes con señal — la mayoría de los roles nunca
        // los visita, y precachearlos igual compite por ancho de banda con la
        // carga real en conexiones intermitentes. Se cachean en runtime
        // (StaleWhileRevalidate, ver src/sw.ts) recién cuando se usan.
        globIgnores: [
          '**/xlsx-*.js',
          '**/pdfjs-*.js',
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
