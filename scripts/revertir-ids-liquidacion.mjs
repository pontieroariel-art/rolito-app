// VUELTA ATRÁS del circuito del 2026-09-18.
//
// Si hay que volver a la versión anterior de la app, las liquidaciones que ya se
// cerraron con la clave nueva (`{remitoId}`) quedan invisibles: la app vieja
// busca `{fecha}_{choferId}` y no las encuentra, así que esos viajes aparecerían
// como si nadie hubiera rendido nada. Este script las copia a la clave vieja.
//
// No borra nada: deja las dos claves. Si después se vuelve a la versión nueva,
// sigue funcionando todo, y el duplicado es un documento de más, no un error.
// Una liquidación que ya exista con la clave vieja no se pisa.
//
// Lo demás de la vuelta atrás no necesita script: los remitos que nacieron en el
// muelle son del mismo tipo de siempre y la app vieja los lee igual, y los
// borradores y los cierres de mercadería la app vieja ni los mira.
//
//   node scripts/revertir-ids-liquidacion.mjs [--aplicar]
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

const snap = await db.collection('liquidaciones').get()
// Las nuevas son las que llevan `remitoId`: su id es el del viaje.
const porViaje = snap.docs.filter((d) => typeof d.data().remitoId === 'string' && d.id === d.data().remitoId)
console.log(`liquidaciones: ${snap.size} | con clave por viaje: ${porViaje.length} | ${APLICAR ? 'APLICANDO' : 'EN SECO'}`)

let copiadas = 0, yaEstaban = 0
for (const d of porViaje) {
  const l = d.data()
  const claveVieja = `${l.fecha}_${l.choferId}`
  const destino = db.doc(`liquidaciones/${claveVieja}`)
  const existe = await destino.get()
  if (existe.exists) {
    // Ese chofer hizo dos viajes ese día: la clave vieja no puede con los dos.
    // Se deja el primero y se avisa, porque el segundo hay que resolverlo a mano.
    yaEstaban++
    console.log(`  ya existe ${claveVieja} (viaje ${d.id}, ${l.codigo ?? 'sin código'}): revisar a mano`)
    continue
  }
  console.log(`  ${d.id} → ${claveVieja} · ${l.choferNombre} · ${l.codigo ?? 'sin código'}`)
  if (APLICAR) await destino.set(l)
  copiadas++
}

console.log(`copiadas: ${copiadas} | choques que hay que mirar: ${yaEstaban}`)
if (!APLICAR) console.log('Fue en seco. Con --aplicar escribe.')
process.exit(0)
