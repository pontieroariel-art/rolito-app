/**
 * fix-address-nombres.mjs
 * Para cada usuario con addresses[], actualiza address.nombre y address.address
 * usando el JSON de mapping (clave = address.id = codigoCliente de esa sucursal).
 *
 * Uso: node scripts/fix-address-nombres.mjs
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccount.json')
const MAPPING_PATH         = path.join(__dirname, 'razon-social-fix.json')
const BATCH_SIZE           = 400

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function main() {
  const rows   = JSON.parse(readFileSync(MAPPING_PATH, 'utf8'))
  const byCode = {}
  for (const { codigoCliente, razonSocial, address } of rows) {
    if (codigoCliente) byCode[codigoCliente.trim()] = { razonSocial: razonSocial.trim(), address: address.trim() }
  }
  console.log(`Mapeo cargado: ${Object.keys(byCode).length} entradas`)

  // Traer todos los clientes que tengan addresses[]
  const snap = await db.collection('users').where('rol', '==', 'cliente').get()
  console.log(`Clientes en Firestore: ${snap.size}`)

  let updated = 0, skipped = 0
  let batch = db.batch(), batchCount = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    if (!Array.isArray(data.addresses) || data.addresses.length === 0) continue

    let changed = false
    const newAddresses = data.addresses.map((addr) => {
      const code  = (addr.id || '').trim()
      const entry = byCode[code]
      if (!entry) return addr

      const nombreOk  = addr.nombre  === entry.razonSocial
      const addressOk = addr.address === entry.address
      if (nombreOk && addressOk) return addr

      changed = true
      return { ...addr, nombre: entry.razonSocial, address: entry.address }
    })

    if (!changed) { skipped++; continue }

    console.log(`  ${data.codigoCliente || doc.id}: actualizando ${newAddresses.filter((a, i) => {
      const old = data.addresses[i]
      return old.nombre !== a.nombre || old.address !== a.address
    }).length} sucursal(es)`)

    batch.update(doc.ref, { addresses: newAddresses })
    batchCount++
    updated++

    if (batchCount >= BATCH_SIZE) {
      await batch.commit()
      console.log(`  [batch commit — ${updated} hasta ahora]`)
      batch = db.batch()
      batchCount = 0
    }
  }

  if (batchCount > 0) await batch.commit()

  console.log(`\nResumen:`)
  console.log(`  Documentos con addresses actualizados : ${updated}`)
  console.log(`  Ya correctos (sin cambios)            : ${skipped}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
