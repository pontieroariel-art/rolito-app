// Escribe `remitoId` / `remitoCodigo` en las ventas del camión y en las
// cobranzas de calle anteriores al 2026-09-18, cruzándolas con el viaje que
// estaba andando cuando se hicieron.
//
// Para qué: desde el 18/09 la plata se rinde POR VIAJE y la app guarda el viaje
// en cada venta al crearla. Las anteriores no lo tienen, y sin esto las
// pantallas tendrían que deducirlo cada vez que las leen. El criterio es el
// mismo de src/utils/viajeDeVenta.ts: el viaje del mismo CAMIÓN en el mismo día
// que ya había salido cuando se hizo la venta.
//
// Lo que no se puede ubicar se deja como está: esa plata se rinde por día, como
// siempre. Preferimos dejar un hueco antes que atribuirle a un viaje una venta
// que quizás no era suya.
//
//   node scripts/backfill-viaje-en-ventas.mjs [--desde 2026-09-01] [--aplicar]
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
const argDesde = process.argv.indexOf('--desde')
const DESDE = argDesde > -1 ? process.argv[argDesde + 1] : '2026-09-01'

const claveDia = (d) => {
  const ar = new Date(d.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  return `${ar.getFullYear()}-${String(ar.getMonth() + 1).padStart(2, '0')}-${String(ar.getDate()).padStart(2, '0')}`
}

const desdeTs = admin.firestore.Timestamp.fromDate(new Date(`${DESDE}T00:00:00-03:00`))

// Los viajes, indexados por día para no recorrerlos enteros en cada venta.
const remitosSnap = await db.collection('remitosCarga').where('fecha', '>=', desdeTs).get()
const porDia = new Map()
for (const d of remitosSnap.docs) {
  const r = { id: d.id, ...d.data() }
  const dia = claveDia(r.fecha.toDate())
  const lista = porDia.get(dia)
  if (lista) lista.push(r); else porDia.set(dia, [r])
}
console.log(`viajes desde ${DESDE}: ${remitosSnap.size} | ${APLICAR ? 'APLICANDO' : 'EN SECO'}`)

/**
 * El viaje de un movimiento: el del mismo camión (o del mismo depósito, para las
 * cobranzas, que no llevan camión) que ya había salido cuando se hizo. Si es
 * anterior a todos, el primero del día: son ventas cargadas antes de salir.
 */
const viajeDe = (mov, claveCamion, claveChofer) => {
  // Igual que utils/viajeDeVenta.ts: primero los viajes del MISMO chofer en ese
  // camión (dos choferes salen con el mismo camión el mismo día: el 21/09 Gerez y
  // González en AF985DC, y la primera corrida le cruzó las ventas a Gerez),
  // después el camión (acompañante sin remito propio), y sin camión, el chofer.
  const delDia = porDia.get(claveDia(mov.fecha.toDate())) ?? []
  const delCamion = claveCamion ? delDia.filter((r) => r.camionId === claveCamion) : []
  const propios = claveChofer ? delCamion.filter((r) => r.choferId === claveChofer) : []
  const candidatos = propios.length ? propios
    : delCamion.length ? delCamion
    : claveChofer ? delDia.filter((r) => r.choferId === claveChofer) : []
  if (!candidatos.length) return null
  const cuando = mov.fecha.toMillis()
  const anteriores = candidatos
    .filter((r) => r.fecha.toMillis() <= cuando)
    .sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis())
  return anteriores[0] ?? [...candidatos].sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis())[0]
}

let batch = db.batch(), enBatch = 0, escritos = 0, sinUbicar = 0
const guardar = async (ref, viaje) => {
  batch.update(ref, { remitoId: viaje.id, remitoCodigo: viaje.codigo ?? '' })
  escritos++
  if (++enBatch >= 400) { if (APLICAR) await batch.commit(); batch = db.batch(); enBatch = 0 }
}

const ventasSnap = await db.collection('ventasCamion').where('fecha', '>=', desdeTs).get()
for (const d of ventasSnap.docs) {
  const v = d.data()
  if (v.remitoId) continue
  const viaje = viajeDe(v, v.camionId, v.choferId)
  if (!viaje) { sinUbicar++; continue }
  await guardar(d.ref, viaje)
}

const cobranzasSnap = await db.collection('cobranzas').where('fecha', '>=', desdeTs).get()
for (const d of cobranzasSnap.docs) {
  const c = d.data()
  // Las de mostrador no son de ningún viaje: caja no sale a repartir.
  if (c.remitoId || c.origen === 'caja') continue
  const viaje = viajeDe(c, null, c.registradoPor?.uid)
  if (!viaje) { sinUbicar++; continue }
  await guardar(d.ref, viaje)
}

if (APLICAR && enBatch) await batch.commit()
console.log(`ventas: ${ventasSnap.size} | cobranzas: ${cobranzasSnap.size}`)
console.log(`con viaje asignado: ${escritos} | sin ubicar (se rinden por día): ${sinUbicar}`)
if (!APLICAR) console.log('Fue en seco. Con --aplicar escribe.')
process.exit(0)
