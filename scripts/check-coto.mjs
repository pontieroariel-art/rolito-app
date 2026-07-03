import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')

const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

// Buscar todos con razonSocial que contenga COTO
const snap = await db.collection('users').where('codigoCliente', '==', 'CT.002').get()
console.log(`Docs encontrados: ${snap.size}`)
for (const d of snap.docs) {
  const data = d.data()
  console.log(`codigoCliente="${data.codigoCliente}" | razonSocial="${data.razonSocial}"`)
  console.log(`addresses (${data.addresses?.length ?? 0}):`)
  for (const addr of (data.addresses ?? [])) {
    console.log(`  id="${addr.id}" | nombre="${addr.nombre}" | address="${addr.address}"`)
  }
}
process.exit(0)
