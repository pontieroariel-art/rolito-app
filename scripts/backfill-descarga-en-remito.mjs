// Marca en cada remito de carga la descarga que ya se contó (2026-09-22).
//
// Desde hoy lo escribe el trigger onDescargaMarcaRemito al crearse la descarga;
// esto completa los remitos anteriores (últimos 45 días) que tienen descarga
// con `remitoId`, para que la tablet del muelle deje de listarlos como
// "en reparto, sin descargar" (caso RC-DT-000082: la descarga se registró en
// Merlo y la tablet de Torcuato no la veía).
//
//   node scripts/backfill-descarga-en-remito.mjs            (muestra)
//   node scripts/backfill-descarga-en-remito.mjs --aplicar
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
const aplicar = process.argv.includes('--aplicar')

const desde = admin.firestore.Timestamp.fromMillis(Date.now() - 45 * 24 * 3600 * 1000)
const descargas = await db.collection('descargasCamion').where('fecha', '>=', desde).get()
// Por remito, la última descarga (una rectificación reemplaza a la original).
const porRemito = new Map()
for (const d of descargas.docs) {
  const x = d.data()
  if (typeof x.remitoId !== 'string' || !x.remitoId) continue
  const prev = porRemito.get(x.remitoId)
  if (!prev || x.fecha.toMillis() > prev.fecha.toMillis()) porRemito.set(x.remitoId, { id: d.id, ...x })
}
let marcar = 0, ya = 0, sinRemito = 0
const batch = db.batch()
for (const [remitoId, d] of porRemito) {
  const r = await db.doc(`remitosCarga/${remitoId}`).get()
  if (!r.exists) { sinRemito++; continue }
  if (r.data().descarga?.id === d.id) { ya++; continue }
  console.log(`${r.data().codigo} ← ${d.codigo ?? d.id} (${d.plantaId}, ${d.fecha.toDate().toISOString().slice(0, 16)})`)
  marcar++
  if (aplicar) batch.set(r.ref, { descarga: { id: d.id, codigo: d.codigo ?? null, hora: d.fecha, plantaId: String(d.plantaId ?? ''), ...(d.rectificaA ? { rectificaA: d.rectificaA } : {}) } }, { merge: true })
}
console.log(`\nremitos a marcar: ${marcar}, ya marcados: ${ya}, descargas con remito inexistente: ${sinRemito}`)
if (!aplicar) { console.log('(sin --aplicar: no se escribió nada)'); process.exit(0) }
if (marcar) await batch.commit()
console.log('APLICADO')
process.exit(0)
