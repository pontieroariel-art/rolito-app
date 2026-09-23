// Ventas y cobranzas atadas al viaje de OTRO chofer (2026-09-21).
//
// El backfill del 21/09 ubicaba cada venta vieja por CAMIÓN y día. Cuando dos
// choferes salen con el mismo camión el mismo día (Gerez a las 5 y González a
// las 7 con AF985DC; Jara y Álvarez el 16/09 con AH954MH), las ventas del primero
// caían en el viaje del segundo: caja no las veía en la liquidación de Gerez.
//
// Este script busca todo movimiento cuyo `remitoId` apunte a un remito de otro
// chofer y lo reata al viaje de SU chofer ese día (el que ya había salido cuando
// vendió; sin viaje propio ese día, se le saca el `remitoId` y se rinde por día).
// Si el viaje correcto ya tenía una liquidación de "cierre de arranque" (sin
// firmas, escrita por scripts/cierre-arranque-liquidaciones.ts), la borra para
// que ese script la vuelva a escribir con las ventas que le faltaban:
//
//   node scripts/reparar-viaje-cruzado.mjs [--aplicar]
//   node scripts/.build/cierre-arranque.cjs --desde <día> --hasta <día> --actor <uid> --aplicar
//
// Una liquidación firmada por caja NO se toca: se avisa y se resuelve a mano.
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('./lib/firebase-admin-compat.cjs')
const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
const APLICAR = process.argv.includes('--aplicar')

const claveDia = (d) => {
  const ar = new Date(d.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  return `${ar.getFullYear()}-${String(ar.getMonth() + 1).padStart(2, '0')}-${String(ar.getDate()).padStart(2, '0')}`
}
const hora = (t) => t.toDate().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const desdeTs = admin.firestore.Timestamp.fromDate(new Date('2026-09-01T00:00:00-03:00'))
const remSnap = await db.collection('remitosCarga').where('fecha', '>=', desdeTs).get()
const remitos = new Map(remSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]))

/** El viaje propio del chofer ese día que ya había salido cuando se hizo el movimiento. */
const viajePropio = (mov, choferId) => {
  const dia = claveDia(mov.fecha.toDate())
  const propios = [...remitos.values()].filter((r) => r.choferId === choferId && claveDia(r.fecha.toDate()) === dia)
  if (!propios.length) return null
  const cuando = mov.fecha.toMillis()
  const anteriores = propios.filter((r) => r.fecha.toMillis() <= cuando).sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis())
  return anteriores[0] ?? [...propios].sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis())[0]
}

console.log(`${APLICAR ? 'APLICANDO' : 'EN SECO'} · remitos desde 01/09: ${remitos.size}\n`)
const liquidacionesARehacer = new Map()   // remitoId → { codigo, fecha, chofer }
let reatadas = 0, sinViaje = 0, firmadas = 0

for (const col of ['ventasCamion', 'cobranzas']) {
  const snap = await db.collection(col).where('fecha', '>=', desdeTs).get()
  for (const d of snap.docs) {
    const x = d.data()
    if (!x.remitoId) continue
    const quien = col === 'cobranzas' ? x.registradoPor?.uid : x.choferId
    const nombre = col === 'cobranzas' ? x.registradoPor?.nombre : x.choferNombre
    const actual = remitos.get(x.remitoId)
    if (!actual || actual.choferId === quien) continue

    const correcto = viajePropio(x, quien)
    console.log(`${col} ${d.id} · ${hora(x.fecha)} · ${nombre} · estaba en ${actual.codigo} de ${actual.choferNombre} → ${correcto ? `${correcto.codigo} (propio)` : 'sin viaje propio ese día: se rinde por día'}`)
    if (APLICAR) {
      await d.ref.update(correcto
        ? { remitoId: correcto.id, remitoCodigo: correcto.codigo ?? '' }
        : { remitoId: admin.firestore.FieldValue.delete(), remitoCodigo: admin.firestore.FieldValue.delete() })
    }
    if (correcto) reatadas++; else sinViaje++

    // La liquidación del viaje correcto, si ya se cerró sin estas ventas.
    for (const viaje of [correcto, actual].filter(Boolean)) {
      const liq = await db.doc(`liquidaciones/${viaje.id}`).get()
      if (!liq.exists) continue
      if (liq.data().cierreArranque) liquidacionesARehacer.set(viaje.id, { codigo: liq.data().codigo, fecha: liq.data().fecha, chofer: viaje.choferNombre })
      else { firmadas++; console.log(`   OJO: ${viaje.codigo} tiene la liquidación ${liq.data().codigo} FIRMADA por caja: revisar a mano`) }
    }
  }
}

console.log(`\nreatadas al viaje propio: ${reatadas} · sin viaje propio: ${sinViaje} · liquidaciones firmadas afectadas: ${firmadas}`)
if (liquidacionesARehacer.size) {
  console.log('\nLiquidaciones de cierre de arranque que se borran para rehacerlas con las ventas correctas:')
  for (const [id, l] of liquidacionesARehacer) {
    console.log(`  ${l.codigo} · ${l.fecha} · ${l.chofer} (liquidaciones/${id})`)
    if (APLICAR) await db.doc(`liquidaciones/${id}`).delete()
  }
  const dias = [...new Set([...liquidacionesARehacer.values()].map((l) => l.fecha))].sort()
  console.log(`\nDespués, por cada día: node scripts/.build/cierre-arranque.cjs --desde <día> --hasta <día> --actor <uid> --aplicar   (días: ${dias.join(', ')})`)
}
if (!APLICAR) console.log('\nFue en seco. Con --aplicar escribe.')
process.exit(0)
