import { defineConfig } from 'vitest/config'
import path from 'path'

// Config standalone (no mergeConfig con vite.config.ts): los tests unitarios
// de hoy son funciones puras en Node, no necesitan los plugins de React ni
// VitePWA — sumarlos solo agregaría side effects innecesarios al arrancar
// vitest. Si en el futuro hacen falta tests de componentes con jsdom, ahí sí
// vale la pena revisar si conviene fusionar con vite.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
