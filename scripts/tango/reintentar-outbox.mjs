/**
 * reintentar-outbox.mjs — vuelve a 'pendiente' items de tango-outbox que quedaron en
 * 'error' (agotaron los 5 intentos) después de corregir la causa (config, vendedor,
 * depósito, artículo…). El worker de la nube (onOutboxPendiente / barrido cada 5 min)
 * o el bridge SQL los vuelven a tomar. No toca items confirmados.
 *
 *   node scripts/tango/reintentar-outbox.mjs <id> [<id> ...]     → esos items
 *   node scripts/tango/reintentar-outbox.mjs --todos-en-error    → todos los que estén en 'error'
 *   node scripts/tango/reintentar-outbox.mjs --listar            → muestra los que están en 'error' y no toca nada
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')
if (process.env.FIRESTORE_EMULATOR_HOST) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'rolito-app' })
} else {
  const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(sa) })
}
const db = admin.firestore()
const { FieldValue } = admin.firestore

const args = process.argv.slice(2)
const LISTAR = args.includes('--listar')
const TODOS  = args.includes('--todos-en-error')
const ids    = args.filter((a) => !a.startsWith('--'))

let docs
if (TODOS || LISTAR) docs = (await db.collection('tango-outbox').where('estado', '==', 'error').get()).docs
else if (ids.length) docs = (await Promise.all(ids.map((id) => db.doc('tango-outbox/' + id).get()))).filter((d) => d.exists)
else { console.log('Uso: reintentar-outbox.mjs <id>… | --todos-en-error | --listar'); process.exit(1) }

if (!docs.length) { console.log('No hay items para reintentar.'); process.exit(0) }
for (const d of docs) {
  const x = d.data()
  console.log(`${d.id} | ${x.entidad} ${x.empresa ?? ''} | ${x.estado} (${x.intentos ?? 0} intentos) | ${x.ultimoError ?? ''}`)
  if (LISTAR) continue
  if (x.estado === 'confirmado') { console.log('   ya confirmado, no se toca'); continue }
  await d.ref.update({ estado: 'pendiente', intentos: 0, ultimoError: null, actualizadoEn: FieldValue.serverTimestamp() })
  console.log('   → pendiente')
}
process.exit(0)
