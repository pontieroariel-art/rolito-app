/**
 * fix-duplicate-addresses.mjs
 * Detecta y elimina direcciones duplicadas en el array addresses[] de cada cliente.
 * Dos entradas se consideran duplicadas si tienen el mismo `id` Y el mismo `address`.
 *
 * Uso: node scripts/fix-duplicate-addresses.mjs
 * Añadir --dry-run para solo reportar sin modificar.
 */

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccount.json')
const DRY_RUN = process.argv.includes('--dry-run')

const serviceAccount = JSON.parse(
  (await import('fs')).readFileSync(SERVICE_ACCOUNT_PATH, 'utf8')
)

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const db = admin.firestore()

console.log(DRY_RUN ? '🔍 Modo DRY-RUN (sin cambios)\n' : '🔧 Modo ESCRITURA\n')

const snapshot = await db.collection('users')
  .where('rol', '==', 'cliente')
  .get()

let totalClientes = 0
let totalConDuplicados = 0
let totalDuplicadosEliminados = 0
const batch = db.batch()
let batchCount = 0

for (const doc of snapshot.docs) {
  const data = doc.data()
  const addresses = data.addresses
  if (!Array.isArray(addresses) || addresses.length < 2) continue

  // Deduplicar por combinación id+address
  const seen = new Set()
  const deduped = []
  let hasDups = false

  for (const addr of addresses) {
    const key = `${addr.id ?? ''}__${addr.address ?? ''}`
    if (seen.has(key)) {
      hasDups = true
      totalDuplicadosEliminados++
    } else {
      seen.add(key)
      deduped.push(addr)
    }
  }

  if (!hasDups) continue

  totalConDuplicados++
  console.log(`📋 ${data.razonSocial || data.nombre || doc.id}`)
  console.log(`   CUIT: ${data.cuit ?? '—'}`)
  console.log(`   Addresses: ${addresses.length} → ${deduped.length} (eliminando ${addresses.length - deduped.length} duplicado/s)`)
  console.log('')

  if (!DRY_RUN) {
    batch.update(doc.ref, { addresses: deduped })
    batchCount++
    if (batchCount >= 400) {
      await batch.commit()
      batchCount = 0
    }
  }

  totalClientes++
}

if (!DRY_RUN && batchCount > 0) {
  await batch.commit()
}

console.log('─'.repeat(50))
console.log(`Clientes analizados: ${snapshot.size}`)
console.log(`Clientes con duplicados: ${totalConDuplicados}`)
console.log(`Entradas duplicadas eliminadas: ${totalDuplicadosEliminados}`)
if (DRY_RUN) console.log('\nEjecutá sin --dry-run para aplicar los cambios.')
else console.log('\n✅ Listo.')

process.exit(0)
