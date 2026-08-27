/**
 * aplicar-codigo-tango.mjs
 * Escribe el campo codigoTango (NUEVO, no pisa codigoCliente) en los usuarios
 * de Firestore según el mapeo generado por cross-referencia-clientes.mjs.
 *
 * Uso:
 *   node scripts/tango/aplicar-codigo-tango.mjs
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json')
const MAPEO_PATH           = path.join(__dirname, 'cruce-final-mapeo.json')
const BATCH_SIZE           = 400

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function main() {
  const mapeo = JSON.parse(readFileSync(MAPEO_PATH, 'utf8'))
  console.log(`Mapeo cargado: ${mapeo.length} usuarios`)

  let actualizados = 0
  let batch = db.batch()
  let enBatch = 0

  for (const item of mapeo) {
    const ref = db.collection('users').doc(item.uid)
    batch.update(ref, {
      codigoTango: item.codigoTango,
      idGva14Tango: item.idGva14Tango,
    })
    enBatch++
    actualizados++

    if (enBatch >= BATCH_SIZE) {
      await batch.commit()
      console.log(`  ${actualizados}/${mapeo.length} escritos...`)
      batch = db.batch()
      enBatch = 0
    }
  }

  if (enBatch > 0) {
    await batch.commit()
  }

  console.log('')
  console.log(`Listo -- ${actualizados} usuarios actualizados con codigoTango.`)
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
