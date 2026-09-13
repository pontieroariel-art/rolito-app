/**
 * Migración del recorte del menú por usuario (2026-09-12).
 *
 * El recorte se guardaba como "lo que sí ve" (`sistemasPermitidos`,
 * `pestanasPermitidas`). Eso arrastraba una trampa: cada pantalla nueva de la
 * app quedaba invisible para esa persona hasta que alguien volviera a abrir el
 * modal y guardar. Ahora se guarda "lo que se esconde" (`dominiosOcultos`,
 * `pestanasOcultas`), así lo nuevo aparece solo.
 *
 * Los dos recortes que había en producción estaban vencidos y no reflejaban
 * ninguna decisión vigente, así que se borran y cada uno queda con el menú
 * completo de su rol:
 *
 *  · un chofer con `sistemasPermitidos: ['logistica']` y `pestanasPermitidas: []`.
 *    El rol chofer no tiene dominios de escritorio: usa el Navbar, que no mira
 *    estos campos. El recorte no hacía nada.
 *  · un gerente comercial con los dominios de la época en que "logistica" era
 *    toda la oficina. Con los dominios de hoy ese recorte le sacaba Comercial,
 *    que es justo su trabajo, y su lista de pantallas era el default del rol de
 *    entonces: le faltaban Resumen, Listado de producción y Anulaciones.
 *
 * Uso:  node scripts/migrar-recorte-menu.mjs [--commit]
 * Sin --commit solo muestra lo que haría.
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'))

const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

const COMMIT = process.argv.includes('--commit')

const s = await db.collection('users').get()
const conRecorte = s.docs.filter((d) => {
  const u = d.data()
  return u.sistemasPermitidos !== undefined || u.pestanasPermitidas !== undefined
})

if (conRecorte.length === 0) { console.log('No quedan recortes del modelo viejo.'); process.exit(0) }

console.log(`${conRecorte.length} usuario(s) con recorte viejo:\n`)
for (const d of conRecorte) {
  const u = d.data()
  console.log(`  ${u.nombre ?? d.id} · ${u.rol} · ${u.estado}`)
  console.log(`     dominios:  ${JSON.stringify(u.sistemasPermitidos ?? null)}`)
  console.log(`     pantallas: ${(u.pestanasPermitidas ?? []).length} en la lista`)
}

if (!COMMIT) { console.log('\nSin --commit: no se escribió nada.'); process.exit(0) }

const batch = db.batch()
for (const d of conRecorte) {
  batch.update(d.ref, {
    sistemasPermitidos: admin.firestore.FieldValue.delete(),
    pestanasPermitidas: admin.firestore.FieldValue.delete(),
  })
}
await batch.commit()
console.log(`\nListo: ${conRecorte.length} recorte(s) borrado(s). Cada uno queda con el menú completo de su rol.`)
process.exit(0)
