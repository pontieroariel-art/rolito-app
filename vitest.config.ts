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
    // Incluye functions/: la lógica fiscal de ARCA vive del lado servidor (la
    // clave privada del certificado nunca baja al dispositivo) pero es código
    // puro y tiene que poder testearse sin desplegar nada.
    // scripts/tango: la lógica pura del bridge (armado del pedido de Tango) —
    // corre en la VM sin build, por eso es .mjs, pero se testea acá igual.
    include: ['src/**/*.test.{ts,tsx}', 'functions/src/**/*.test.ts', 'scripts/tango/*.test.mjs'],
    // Cobertura (auditoría 2026-09-22): se mide sobre la lógica pura, que es lo
    // que estos tests cubren; services/hooks/pages del front no entran porque
    // no tienen tests y su medida sería ruido. `npm run test:coverage`.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/utils/**/*.ts', 'functions/src/services/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.smoke.test.ts', 'src/utils/pdf.ts'],
      // Piso: lo medido el 22/09 menos un par de puntos. Que no baje; subirlo
      // cuando se cubra lo que falta (pdf, cot server, outbox).
      thresholds: { statements: 68, branches: 60, functions: 75, lines: 69 },
    },
  },
})
