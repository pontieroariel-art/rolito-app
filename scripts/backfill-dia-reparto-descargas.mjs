// Completa `descargasCamion.diaReparto` ('yyyy-MM-dd', hora de Argentina) en las
// descargas que no lo tienen (anteriores al 2026-09-17): el día del remito de
// carga del viaje si lo referencia, si no el día del conteo. Ver
// src/utils/diaReparto.ts. En seco por defecto; --aplicar escribe.
//
//   node scripts/backfill-dia-reparto-descargas.mjs [--aplicar]
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
const APLICAR = process.argv.includes('--aplicar')

const claveDia = (d) => {
  const ar = new Date(d.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  return `${ar.getFullYear()}-${String(ar.getMonth() + 1).padStart(2, '0')}-${String(ar.getDate()).padStart(2, '0')}`
}

const snap = await db.collection('descargasCamion').get()
const sinDia = snap.docs.filter((d) => typeof d.data().diaReparto !== 'string')
console.log(`descargas: ${snap.size} | sin diaReparto: ${sinDia.length} | ${APLICAR ? 'APLICANDO' : 'EN SECO'}`)

const remitos = new Map()
let batch = db.batch(), enBatch = 0, distintos = 0
for (const d of sinDia) {
  const x = d.data()
  let base = x.fecha?.toDate?.() ?? new Date()
  if (x.remitoId) {
    if (!remitos.has(x.remitoId)) remitos.set(x.remitoId, (await db.doc(`remitosCarga/${x.remitoId}`).get()).data() ?? null)
    const rem = remitos.get(x.remitoId)
    if (rem?.fecha?.toDate) base = rem.fecha.toDate()
  }
  const diaReparto = claveDia(base)
  const diaConteo = claveDia(x.fecha?.toDate?.() ?? new Date())
  if (diaReparto !== diaConteo) { distintos++; console.log(`  ${d.id} ${x.choferNombre ?? ''} contada ${diaConteo} → viaje ${diaReparto} (${x.remitoCodigo ?? 'sin remito'})`) }
  if (APLICAR) { batch.update(d.ref, { diaReparto }); enBatch++ }
  if (enBatch >= 400) { await batch.commit(); batch = db.batch(); enBatch = 0 }
}
if (enBatch) await batch.commit()
console.log(`listo: ${sinDia.length} descargas${APLICAR ? ' actualizadas' : ' a actualizar'}, ${distintos} con día de viaje distinto al del conteo`)
