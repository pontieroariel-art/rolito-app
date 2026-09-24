/**
 * bridge-sync-comprobantes.mjs — corrida MANUAL del lector de facturas y remitos de Tango.
 *
 * La sincronización normal la hace bridge-sql.mjs solo (cada config/tango.comprobantes.intervaloMin
 * minutos, default 60, y a pedido desde la app). Este wrapper sirve para la primera carga y
 * para probar; la lógica está en comprobantes-sync.mjs (docs/tango/INTEGRACION.md §35).
 *
 * Uso (en C:\RolitoSync\sql\, con bridge-sql.config.json):
 *   node bridge-sync-comprobantes.mjs --dry-run                 no escribe nada; muestra qué haría
 *   node bridge-sync-comprobantes.mjs --backfill                primera carga: 400 días hacia atrás
 *   node bridge-sync-comprobantes.mjs --empresa=redonhielo      una sola empresa
 *   node bridge-sync-comprobantes.mjs --cliente=PA.003          un solo código (para probar)
 *   node bridge-sync-comprobantes.mjs                           una pasada normal (ventana de 45 días)
 */

import { readFileSync, appendFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { abrirFirestore } from './firestore-admin.mjs'
import { sincronizarComprobantes, cerrarConexiones } from './comprobantes-sync.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DRY_RUN = process.argv.includes('--dry-run')
const BACKFILL = process.argv.includes('--backfill')
const arg = (nombre) => { const a = process.argv.find((x) => x.startsWith(`--${nombre}=`)); return a ? a.slice(nombre.length + 3) : null }

const CONFIG_PATH = path.join(__dirname, 'bridge-sql.config.json')
const cfg = (() => {
  const texto = readFileSync(CONFIG_PATH, 'utf8')
  return JSON.parse(texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto)
})()
const LOG_FILE = cfg.comprobantes?.logFile ?? path.join(path.dirname(cfg.logFile ?? path.join(__dirname, 'x.log')), 'bridge-sync-comprobantes.log')

function log(linea) {
  const conFecha = `[${new Date().toISOString()}] ${linea}`
  console.log(conFecha)
  try { appendFileSync(LOG_FILE, conFecha + '\n', 'utf8') } catch { /* best effort */ }
}

async function main() {
  let db = null
  if (!DRY_RUN) {
    // Admin SDK con la cuenta de servicio rolito-bridge (2026-09-23, docs/tango §37): sin App Check ni usuario.
    const abierto = abrirFirestore(cfg, __dirname)
    db = abierto.db
    log(`Firestore abierto como ${abierto.cuenta}.`)
  }
  const cliente = arg('cliente')
  const r = await sincronizarComprobantes({
    cfg, db, log, dryRun: DRY_RUN, backfill: BACKFILL, soloEmpresa: arg('empresa'),
    codigos: cliente ? [cliente] : null,
  })
  await cerrarConexiones()
  process.exit(r.ok ? 0 : 1)
}

main().catch((err) => { log(`ERROR FATAL: ${err.stack ?? err.message}`); process.exit(1) })
