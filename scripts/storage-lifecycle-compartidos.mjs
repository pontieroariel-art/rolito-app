// Ciclo de vida del bucket de Storage para los comprobantes publicados desde el
// visor (carpeta `compartidos/`, 2026-09-15): se borran solos a los 60 días.
// Decisión de Ariel: el link que va en el WhatsApp deja de funcionar después de
// ese plazo; si el cliente lo necesita de nuevo se le vuelve a mandar desde la app.
//
// Toca SOLO la regla con prefijo `compartidos/`: las demás reglas del bucket (si
// las hubiera) se conservan. Sin gsutil/gcloud en esta máquina, va por el Admin SDK.
//
// Uso (desde la raíz del repo, con scripts/serviceAccount.json):
//   node scripts/storage-lifecycle-compartidos.mjs            → muestra lo que hay y lo que haría
//   node scripts/storage-lifecycle-compartidos.mjs --aplicar  → escribe la regla
//   node scripts/storage-lifecycle-compartidos.mjs --dias 30  → otro plazo

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
// Mismo firebase-admin que usan los otros scripts (el de functions/).
const admin = require('./lib/firebase-admin-compat.cjs')
const args = process.argv.slice(2)
const aplicar = args.includes('--aplicar')
const iDias = args.indexOf('--dias')
const dias = iDias >= 0 ? Number(args[iDias + 1]) : 60
if (!Number.isInteger(dias) || dias < 1) throw new Error('--dias tiene que ser un entero positivo')

const PREFIJO = 'compartidos/'
const BUCKET = 'rolito-app.firebasestorage.app'

const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa), storageBucket: BUCKET })
const bucket = admin.storage().bucket()

const [meta] = await bucket.getMetadata()
const reglas = meta.lifecycle?.rule ?? []
console.log(`Bucket ${bucket.name}: ${reglas.length} regla(s) de ciclo de vida hoy`)
for (const r of reglas) console.log('  -', JSON.stringify(r))

const esNuestra = (r) => (r.condition?.matchesPrefix ?? []).includes(PREFIJO)
const nueva = { action: { type: 'Delete' }, condition: { age: dias, matchesPrefix: [PREFIJO] } }
const resultado = [...reglas.filter((r) => !esNuestra(r)), nueva]

console.log(`\nRegla para ${PREFIJO}: borrar a los ${dias} días →`, JSON.stringify(nueva))
if (!aplicar) { console.log('\n(dry-run: nada escrito; corré con --aplicar)'); process.exit(0) }

await bucket.setMetadata({ lifecycle: { rule: resultado } })
const [despues] = await bucket.getMetadata()
const ok = (despues.lifecycle?.rule ?? []).some((r) => esNuestra(r) && r.condition.age === dias && r.action?.type === 'Delete')
console.log(ok ? `\nListo: ${PREFIJO} se borra a los ${dias} días (${despues.lifecycle.rule.length} regla(s) en total).` : '\nALGO FALLÓ: la regla no aparece después de escribir.')
process.exit(ok ? 0 : 1)
