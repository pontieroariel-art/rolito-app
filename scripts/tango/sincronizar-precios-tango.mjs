// Corre a mano la misma sincronización de precios que la Cloud Function
// syncPreciosTango (functions/src/services/tango/precios.ts), con el Admin SDK
// local. Sirve para la PRIMERA carga en prod antes de publicar el frontend
// (docs/tango/INTEGRACION.md §17) o para probar contra el emulador.
//
//   node scripts/tango/sincronizar-precios-tango.mjs            # escribe preciosTango/* y users.listaTango
//   node scripts/tango/sincronizar-precios-tango.mjs --dry-run  # solo lee Tango e imprime el resumen
//
// Token: env TANGO_TOKEN o scripts/tango/bridge-sync-clientes.config.json (tangoToken).
// Credenciales: scripts/serviceAccount.json (prod) o FIRESTORE_EMULATOR_HOST.
// Requiere `npm --prefix functions run build` (importa functions/lib).

import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Mismo firebase-admin que usa functions/lib (si no, el Firestore del script y
// el FieldValue de precios.js serían de paquetes distintos).
const require = createRequire(import.meta.url)
const admin      = require('../../functions/node_modules/firebase-admin/lib/index.js')
const clientMod  = require('../../functions/lib/services/tango/client.js')
const preciosMod = require('../../functions/lib/services/tango/precios.js')
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
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

const { TangoClient } = clientMod
const { sincronizarPreciosTango, leerPreciosEmpresa, EMPRESAS } = preciosMod

const cfg = (await db.doc('config/tango').get()).data() ?? {}
if (!cfg.companies) throw new Error('config/tango sin companies')
const tango = new TangoClient({ baseUrl: cfg.connectBaseUrl ?? BASE, token: token(), timeoutMs: 60_000 })

const inicio = Date.now()
if (DRY) {
  for (const empresa of EMPRESAS) {
    const company = cfg.companies[empresa]
    if (!Number.isInteger(company)) { console.log(`[${empresa}] sin company en config/tango.companies`); continue }
    const r = await leerPreciosEmpresa(tango, company, cfg.articulos ?? {})
    console.log(`[${empresa}] company ${company}: ${JSON.stringify(r.resumen)}`)
    for (const [nro, l] of Object.entries(r.listas).slice(0, 5)) console.log(`   lista ${nro} ${l.nombre}${l.incluyeIva ? ' (IVA inc.)' : ''}: ${JSON.stringify(l.precios)}`)
    const esp = Object.entries(r.especiales).slice(0, 3)
    for (const [cli, p] of esp) console.log(`   especial ${cli}: ${JSON.stringify(p)}`)
  }
} else {
  const resumen = await sincronizarPreciosTango(db, tango, cfg)
  await db.doc('config/tango').set({
    preciosSync: { ultimaCorrida: admin.firestore.FieldValue.serverTimestamp(), origen: 'script', uid: null, duracionMs: Date.now() - inicio, resumen },
  }, { merge: true })
  console.log(JSON.stringify(resumen, null, 2))
}
console.log(`listo en ${Date.now() - inicio} ms`)
await admin.app().delete()
