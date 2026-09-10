/**
 * backfill-clientes-index.mjs — carga inicial de clientesIndex/{uid} (búsqueda liviana de
 * clientes, 2026-09-10) a partir de users (rol cliente). Después lo mantiene el trigger
 * onClienteIndexado. Idempotente: solo escribe los índices que faltan o cambiaron.
 *
 * Requiere scripts/serviceAccount.json y functions/lib compilado (usa la misma lógica pura).
 *   node scripts/backfill-clientes-index.mjs            → dry-run
 *   node scripts/backfill-clientes-index.mjs --commit
 */
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const admin = require('../functions/node_modules/firebase-admin/lib/index.js')
const { indiceDeCliente, mismoIndice } = require('../functions/lib/services/clientesIndex.js')
const COMMIT = process.argv.includes('--commit')

const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

const users = await db.collection('users').where('rol', '==', 'cliente').get()
const existentes = new Map((await db.collection('clientesIndex').get()).docs.map((d) => [d.id, d.data()]))
console.log(`Modo: ${COMMIT ? 'COMMIT' : 'DRY-RUN'} · clientes en users: ${users.size} · índices existentes: ${existentes.size}`)

let escribir = 0, iguales = 0, activos = 0
let batch = db.batch(), enBatch = 0
for (const d of users.docs) {
  const nuevo = indiceDeCliente(d.id, d.data())
  if (!nuevo) continue
  if (nuevo.estado === 'activo') activos++
  if (mismoIndice(existentes.get(d.id), nuevo)) { iguales++; continue }
  escribir++
  if (COMMIT) {
    batch.set(db.doc(`clientesIndex/${d.id}`), { ...nuevo, actualizadoEn: admin.firestore.FieldValue.serverTimestamp() })
    if (++enBatch >= 400) { await batch.commit(); batch = db.batch(); enBatch = 0; console.log(`  escritos ${escribir}`) }
  }
}
if (COMMIT && enBatch) await batch.commit()
const sobrantes = [...existentes.keys()].filter((id) => !users.docs.some((d) => d.id === id))
if (COMMIT) for (const id of sobrantes) await db.doc(`clientesIndex/${id}`).delete()
console.log(`Índices a escribir: ${escribir} · sin cambios: ${iguales} · activos: ${activos} · sobrantes borrados: ${sobrantes.length}${COMMIT ? '' : ' (dry-run: nada escrito)'}`)
process.exit(0)
