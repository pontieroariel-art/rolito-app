// Corre a mano, con el Admin SDK local, las sincronizaciones de clientes y
// saldos por Tango Connect (misma lógica que las Cloud Functions
// syncClientesTangoConnect / syncSaldosTangoConnect — functions/src/triggers/tangoConnectSync.ts).
// Sirve para la primera corrida o para verificar sin esperar a la programada.
//
//   node scripts/tango/sincronizar-tango-connect.mjs --clientes
//   node scripts/tango/sincronizar-tango-connect.mjs --saldos
//   node scripts/tango/sincronizar-tango-connect.mjs --clientes --saldos --dry-run   # solo lee Tango y cuenta
//
// Token: env TANGO_TOKEN o scripts/tango/bridge-sync-clientes.config.json (tangoToken).
// Credenciales: scripts/serviceAccount.json (prod) o FIRESTORE_EMULATOR_HOST.
// Requiere `npm --prefix functions run build` (importa functions/lib).

import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const admin   = require('../../functions/node_modules/firebase-admin/lib/index.js')
const { TangoClient, PROCESOS } = require('../../functions/lib/services/tango/client.js')
const sync    = require('../../functions/lib/triggers/tangoConnectSync.js')

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const QUIERE_CLIENTES = args.includes('--clientes')
const QUIERE_SALDOS   = args.includes('--saldos')
if (!QUIERE_CLIENTES && !QUIERE_SALDOS) { console.error('Indicá --clientes y/o --saldos'); process.exitCode = 1 }
const BASE = process.env.TANGO_BASE_URL ?? 'https://001174-003.connect.axoft.com'

if (process.env.FIRESTORE_EMULATOR_HOST) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'rolito-app' })
} else {
  const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(sa) })
}
const db = admin.firestore()

function token() {
  if (process.env.TANGO_TOKEN) return process.env.TANGO_TOKEN
  const p = path.join(__dirname, 'bridge-sync-clientes.config.json')
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')).tangoToken
  throw new Error('Falta el token: env TANGO_TOKEN o scripts/tango/bridge-sync-clientes.config.json')
}

const cfg = (await db.doc('config/tango').get()).data() ?? {}
const tango = new TangoClient({ baseUrl: cfg.connectBaseUrl ?? BASE, token: token(), timeoutMs: 60_000 })
const guardar = (campo, origen, inicio, resumen) => db.doc('config/tango').set({
  [campo]: { ultimaCorrida: admin.firestore.FieldValue.serverTimestamp(), origen, uid: null, duracionMs: Date.now() - inicio, resumen },
}, { merge: true })

if (QUIERE_CLIENTES) {
  const inicio = Date.now()
  if (DRY) {
    const filas = await tango.getAll(cfg.companies.redonhielo, PROCESOS.clientes, 200)
    const rows = filas.map(sync.recortarCliente)
    console.log(`[clientes] ${rows.length} clientes en Tango; muestra:`, rows.slice(0, 2))
  } else {
    const resumen = await sync.sincronizarClientes(db, tango, cfg)
    await guardar('clientesSync', 'script', inicio, resumen)
    console.log('[clientes]', JSON.stringify({ ...resumen, errores: resumen.errores.slice(0, 5) }, null, 2))
  }
  console.log(`[clientes] listo en ${Date.now() - inicio} ms`)
}

if (QUIERE_SALDOS) {
  const inicio = Date.now()
  if (DRY) {
    const hasta = new Date(); hasta.setFullYear(hasta.getFullYear() + 5)
    const dd = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
    const filas = await tango.live(cfg.companies.redonhielo, cfg.saldos?.procesoDeudasVencidas ?? 17953, cfg.saldos?.fromDate ?? '01/01/2015', dd(hasta))
    console.log(`[saldos] ${filas.length} comprobantes vencidos; muestra:`, filas.slice(0, 1).map(sync.recortarComprobante))
  } else {
    const resumen = await sync.sincronizarSaldos(db, tango, cfg)
    await guardar('saldosSync', 'script', inicio, resumen)
    console.log('[saldos]', JSON.stringify(resumen, null, 2))
  }
  console.log(`[saldos] listo en ${Date.now() - inicio} ms`)
}

await admin.app().delete()
