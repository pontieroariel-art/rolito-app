/**
 * fix-razon-social.mjs
 * Actualiza razonSocial + address en Firestore según la hoja "Clientes" del Excel.
 * Matchea por codigoCliente. No toca lat/lng ni otros campos.
 *
 * Uso: node scripts/fix-razon-social.mjs
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
  // Cargar mapeo del Excel (hoja Clientes)
  const rows   = JSON.parse(readFileSync(MAPPING_PATH, 'utf8'))
  const byCode = {}
  for (const { codigoCliente, razonSocial, address } of rows) {
    if (codigoCliente) byCode[codigoCliente.trim()] = { razonSocial: razonSocial.trim(), address: address.trim() }
  }
  console.log(`Mapeo cargado: ${Object.keys(byCode).length} entradas`)

  // Traer todos los usuarios con codigoCliente en Firestore
  const snap = await db.collection('users').where('codigoCliente', '!=', '').get()
  console.log(`Usuarios con codigoCliente en Firestore: ${snap.size}`)

  let updated = 0, skipped = 0, notFound = 0
  let batch = db.batch(), batchCount = 0

  for (const doc of snap.docs) {
    const data   = doc.data()
    const codigo = (data.codigoCliente || '').trim()
    const entry  = byCode[codigo]

    if (!entry) { notFound++; continue }

    const razonOk   = data.razonSocial === entry.razonSocial
    const addressOk = data.address      === entry.address

    if (razonOk && addressOk) { skipped++; continue }

    const update = {
      razonSocial: entry.razonSocial,
      nombre:      entry.razonSocial,
      address:     entry.address,
    }

    // Si tiene addresses[], actualizar también el address string de cada entrada
    // (conservar lat/lng/id/nombre de sucursal — solo actualizar el string)
    if (Array.isArray(data.addresses) && data.addresses.length > 0) {
      // Solo actualizar la primera dirección si es la única (evitar pisar sucursales distintas)
      if (data.addresses.length === 1) {
        update['addresses'] = [{ ...data.addresses[0], address: entry.address }]
      }
    }

    console.log(`  ${codigo}: razon="${entry.razonSocial}" addr="${entry.address}"`)
    batch.update(doc.ref, update)
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
  console.log(`  Actualizados : ${updated}`)
  console.log(`  Ya correctos : ${skipped}`)
  console.log(`  Sin match    : ${notFound}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
