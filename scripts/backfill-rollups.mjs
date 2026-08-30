/**
 * backfill-rollups.mjs
 * Genera los rollups diarios de pedidos (rollupsPedidos/{YYYY-MM-DD}) y el
 * ultimoPedidoAt de cada cliente a partir de los pedidos ya existentes. Se corre
 * UNA vez al desplegar el trigger onOrderRollup (functions/src/triggers/rollups.ts);
 * de ahí en más el trigger los mantiene solo. Ver auditoría 2026-08-29 (H5).
 *
 * Uso:
 *   node scripts/backfill-rollups.mjs            # dry-run (no escribe)
 *   node scripts/backfill-rollups.mjs --aplicar  # escribe rollups + ultimoPedidoAt
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')

const serviceAccount = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

// Mismos criterios que functions/src/triggers/rollups.ts (Argentina UTC-3 fijo).
const OFFSET_ARG_MS = 3 * 60 * 60 * 1000
const diaArg = (ts) => new Date(ts.toMillis() - OFFSET_ARG_MS).toISOString().slice(0, 10)
const ESTADOS = ['pendiente', 'confirmado', 'en_camino', 'entregado', 'cancelado']

const APLICAR = process.argv.includes('--aplicar')

async function main() {
  console.log('Leyendo todos los pedidos...')
  const snap = await db.collection('orders').get()
  console.log(`${snap.size} pedidos.`)

  const rollups = {}   // fecha -> rollup
  const ultimo  = {}   // clientId -> ms del último pedido

  for (const doc of snap.docs) {
    const o = doc.data()
    if (!o.date?.toMillis) continue
    const fecha  = diaArg(o.date)
    const estado = ESTADOS.includes(o.status) ? o.status : 'pendiente'
    const r = rollups[fecha] ?? (rollups[fecha] = {
      fecha, total: 0, bolsas: 0,
      porEstado: { pendiente: 0, confirmado: 0, en_camino: 0, entregado: 0, cancelado: 0 },
      porCliente: {},
    })
    r.porEstado[estado]++
    if (estado !== 'cancelado') {
      r.total++
      const q = (o.products ?? []).reduce((s, p) => s + (p.quantity ?? 0), 0)
      r.bolsas += q
      if (o.clientId) {
        const c = r.porCliente[o.clientId] ?? (r.porCliente[o.clientId] = { nombre: o.clientName ?? '', bolsas: 0, pedidos: 0 })
        c.bolsas += q
        c.pedidos++
      }
    }
    if (o.clientId) {
      const ms = o.date.toMillis()
      if (!ultimo[o.clientId] || ms > ultimo[o.clientId]) ultimo[o.clientId] = ms
    }
  }

  const fechas = Object.keys(rollups).sort()
  console.log(`${fechas.length} días de rollups · ${Object.keys(ultimo).length} clientes con ultimoPedidoAt.`)

  if (!APLICAR) {
    console.log('\nDRY-RUN (agregá --aplicar para escribir). Últimos 5 días:')
    fechas.slice(-5).forEach((f) => console.log(`  ${f}: ${rollups[f].total} pedidos, ${rollups[f].bolsas} bolsas`))
    process.exit(0)
  }

  console.log('\nEscribiendo rollups...')
  let batch = db.batch(), n = 0
  for (const f of fechas) {
    batch.set(db.doc(`rollupsPedidos/${f}`), { ...rollups[f], updatedAt: admin.firestore.FieldValue.serverTimestamp() })
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch() }
  }
  await batch.commit()
  console.log(`  ${fechas.length} rollups escritos.`)

  console.log('Escribiendo ultimoPedidoAt...')
  batch = db.batch(); n = 0
  for (const [cid, ms] of Object.entries(ultimo)) {
    batch.set(db.doc(`users/${cid}`), { ultimoPedidoAt: admin.firestore.Timestamp.fromMillis(ms) }, { merge: true })
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch() }
  }
  await batch.commit()
  console.log(`  ${Object.keys(ultimo).length} clientes actualizados.`)
  process.exit(0)
}

main().catch((err) => { console.error('Error fatal:', err); process.exit(1) })
