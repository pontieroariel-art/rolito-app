/**
 * limpiar-outbox-produccion.mjs — borra de tango-outbox los items de pallets de
 * producción (`entidad: 'produccionPallet'`) que quedaron pendientes de las
 * pruebas del 2026-08-28: ningún worker los toma (los pallets no viajan a Tango)
 * y el panel los cuenta como cola pendiente.
 *
 * Uso:  node scripts/tango/limpiar-outbox-produccion.mjs            → lista
 *       node scripts/tango/limpiar-outbox-produccion.mjs --commit   → borra
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')
const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
const COMMIT = process.argv.includes('--commit')

const snap = await db.collection('tango-outbox').where('entidad', '==', 'produccionPallet').get()
console.log(`Items de producción en la cola: ${snap.size}`)
for (const d of snap.docs) {
  const x = d.data()
  console.log(`  ${d.id} · ${x.estado} · creado ${x.creadoEn?.toDate?.().toISOString().slice(0, 10)}`)
  if (COMMIT) await d.ref.delete()
}
console.log(COMMIT ? 'BORRADOS' : 'DRY-RUN — correr con --commit para borrar')
process.exit(0)
