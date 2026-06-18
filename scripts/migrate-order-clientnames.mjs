/**
 * migrate-order-clientnames.mjs
 * Actualiza clientName de pedidos existentes al nombre correcto de la sucursal
 * (addr.nombre), que es el mismo valor que la UI muestra al crear un pedido manual.
 *
 * Solo modifica pedidos donde:
 *  - el clientId apunta a un usuario con addresses[]
 *  - la clientAddress matchea exactamente (normalizada) con una de sus sucursales
 *
 * Uso: node scripts/migrate-order-clientnames.mjs
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccount.json')
const BATCH_SIZE           = 400

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const norm = (s) => (s ?? '').trim().toLowerCase()

async function main() {
  // Cargar todos los clientes con sucursales
  const usersSnap = await db.collection('users').where('rol', '==', 'cliente').get()
  const userMap = {}
  for (const doc of usersSnap.docs) {
    const data = doc.data()
    if (Array.isArray(data.addresses) && data.addresses.length > 0) {
      userMap[doc.id] = { uid: doc.id, ...data }
    }
  }
  console.log(`Clientes con sucursales: ${Object.keys(userMap).length}`)

  // Cargar todos los pedidos
  const ordersSnap = await db.collection('orders').get()
  console.log(`Pedidos totales: ${ordersSnap.size}`)

  let updated = 0, skipped = 0, noClient = 0, noMatch = 0, ambiguous = 0
  let batch = db.batch(), batchCount = 0

  for (const orderDoc of ordersSnap.docs) {
    const order = orderDoc.data()

    // Ignorar pedidos sin clientId o de clientes externos
    const client = userMap[order.clientId]
    if (!client) { noClient++; continue }

    // Buscar sucursal que coincida con clientAddress (normalizado)
    const matches = client.addresses.filter(
      (a) => norm(a.address) === norm(order.clientAddress),
    )

    if (matches.length === 0) { noMatch++; continue }
    if (matches.length > 1)   { ambiguous++; continue }

    const addr     = matches[0]
    const baseName = client.razonSocial || client.nombre || client.email
    const newName  = addr.nombre || baseName

    if (order.clientName === newName) { skipped++; continue }

    console.log(`  [${orderDoc.id}] "${order.clientName}" → "${newName}"`)
    batch.update(orderDoc.ref, { clientName: newName, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
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
  console.log(`  Actualizados               : ${updated}`)
  console.log(`  Ya correctos (sin cambio)  : ${skipped}`)
  console.log(`  Sin cliente con sucursales : ${noClient}`)
  console.log(`  Sin match de dirección     : ${noMatch}`)
  console.log(`  Ambiguo (2+ sucursales)    : ${ambiguous}`)

  if (noMatch > 0 || ambiguous > 0) {
    console.log(`\n⚠  Los pedidos "sin match" o "ambiguos" no fueron tocados.`)
    console.log(`   Revisalos manualmente si son de clientes con múltiples sucursales.`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
