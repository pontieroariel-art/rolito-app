/**
 * backfill-ventas-producto.mjs — rehace rollupsVentasProducto de los últimos N días
 * (2026-09-25). La función programada rollupVentasProducto solo rehace HOY y AYER
 * cada 15 minutos; esto completa el historial para los períodos de 7 y 30 días del
 * panel de producción. Usa la MISMA cuenta que la función (functions/lib).
 *
 *   node scripts/backfill-ventas-producto.mjs          → últimos 30 días
 *   node scripts/backfill-ventas-producto.mjs 60       → últimos 60 días
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('./lib/firebase-admin-compat.cjs')
const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })

const { recalcularVentasProducto, diaArgDe } = require('../functions/lib/triggers/ventasProductoRollup.js')
const dias = Number(process.argv[2] ?? 30)
const ahora = Date.now()
for (let i = 0; i < dias; i++) {
  const fecha = diaArgDe(new Date(ahora - i * 86_400_000))
  await recalcularVentasProducto(fecha)
  process.stdout.write(`${fecha} `)
}
console.log('\nListo.')
process.exit(0)
