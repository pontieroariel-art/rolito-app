/**
 * cola-transferencias.mjs — muestra los items `transferenciaDeposito` (remito de carga = CAR,
 * descarga = DES) de tango-outbox con su estado, para elegir el id del `--dry-run --solo=<id>`
 * en el bridge y ver qué confirmó Tango. Solo lectura (producción, scripts/serviceAccount.json).
 *
 *   node scripts/tango/cola-transferencias.mjs            → últimos 20
 *   node scripts/tango/cola-transferencias.mjs --pendientes
 */
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const admin = require('../../functions/node_modules/firebase-admin/lib/index.js')
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))) })
const db = admin.firestore()

const soloPendientes = process.argv.includes('--pendientes')
let q = db.collection('tango-outbox').where('entidad', '==', 'transferenciaDeposito')
if (soloPendientes) q = q.where('estado', 'in', ['pendiente', 'enviado', 'error'])
const snap = await q.get()
const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  .sort((a, b) => (b.creadoEn?.toMillis?.() ?? 0) - (a.creadoEn?.toMillis?.() ?? 0))
  .slice(0, soloPendientes ? 100 : 20)

const cfg = (await db.doc('config/tango').get()).data() ?? {}
console.log(`transferenciasSqlEnabled = ${cfg.transferenciasSqlEnabled ?? false} · tipos carga/descarga: ${JSON.stringify(cfg.sql?.stock?.tipos?.carga ?? null)} / ${JSON.stringify(cfg.sql?.stock?.tipos?.descarga ?? null)}\n`)
if (!items.length) console.log(soloPendientes ? 'No hay transferencias pendientes.' : 'Todavía no hay ningún remito de carga ni descarga en la cola.')
for (const it of items) {
  const p = it.payload ?? {}
  const items = (p.items ?? []).map((i) => `${i.cantidad} ${i.productoId}`).join(', ')
  console.log(`${it.id}\n  ${p.sentido?.toUpperCase()} ${p.codigo ?? ''} · planta ${p.plantaId} · depósito ${p.depositoTango ?? '(sin depositoTango: usa config/tango.depositos)'} · ${p.choferNombre ?? p.choferId ?? ''}\n  ${items || '(sin items)'}\n  estado ${it.estado} (intentos ${it.intentos ?? 0})${it.ultimoError ? ` · último error: ${it.ultimoError}` : ''}${it.resultado ? ` · Tango: ${it.resultado.tComp} ${it.resultado.transferenciaNumero} (ID_STA14 ${it.resultado.idSta14}, ${it.resultado.origen} → ${it.resultado.destino})` : ''}`)
}
process.exit(0)
