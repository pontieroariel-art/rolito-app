import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
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
