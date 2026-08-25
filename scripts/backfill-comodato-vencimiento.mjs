/**
 * backfill-comodato-vencimiento.mjs
 * Completa comodatoFirmadoEl/comodatoVenceEl/comodatoAvisoEnviado en las
 * heladeras en_comodato que ya existían antes del sistema de renovación
 * (las 1294 importadas del listado histórico — nunca tuvieron una firma
 * real, así que se les asigna vencimiento = fechaAsignacion + 12 meses).
 * La gran mayoría va a arrancar "vencida" desde el día uno — es intencional,
 * el CUPO_SEMANAL de avisarComodatosPorVencer (functions/src/triggers/
 * comodatos.ts) es lo que evita mandarle al encargado los ~1300 de una vez.
 *
 * Uso:
 *   node scripts/backfill-comodato-vencimiento.mjs            → dry-run
 *   node scripts/backfill-comodato-vencimiento.mjs --commit    → escribe
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')

const COMMIT = process.argv.includes('--commit')

const serviceAccount = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

function agregarUnAnio(timestamp) {
  const d = timestamp.toDate()
  d.setFullYear(d.getFullYear() + 1)
  return admin.firestore.Timestamp.fromDate(d)
}

async function main() {
  console.log(`Modo: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  const snap = await db.collection('heladeras').where('estado', '==', 'en_comodato').get()
  console.log(`Heladeras en_comodato: ${snap.size}`)

  const pendientes = snap.docs.filter((d) => d.data().comodatoVenceEl == null)
  console.log(`Sin comodatoVenceEl (a completar): ${pendientes.length}`)

  const sinFechaAsignacion = pendientes.filter((d) => !d.data().fechaAsignacion)
  console.log(`De esas, sin fechaAsignacion tampoco (quedan sin tocar): ${sinFechaAsignacion.length}`)

  if (!COMMIT) {
    console.log('\nDRY-RUN — no se escribió nada. Corré con --commit para aplicar.')
    process.exit(0)
  }

  let batch = db.batch()
  let ops = 0
  let actualizadas = 0
  for (const doc of pendientes) {
    const fechaAsignacion = doc.data().fechaAsignacion
    if (!fechaAsignacion) continue
    batch.update(doc.ref, {
      comodatoFirmadoEl:    fechaAsignacion,
      comodatoVenceEl:      agregarUnAnio(fechaAsignacion),
      comodatoAvisoEnviado: false,
      comodatoNumero:       null,
    })
    ops++
    actualizadas++
    if (ops >= 400) {
      await batch.commit()
      batch = db.batch()
      ops = 0
      process.stdout.write(`\r  ${actualizadas}/${pendientes.length}   `)
    }
  }
  if (ops > 0) await batch.commit()

  console.log(`\n\nActualizadas: ${actualizadas}`)
  process.exit(0)
}

main().catch((err) => { console.error('Error fatal:', err); process.exit(1) })
