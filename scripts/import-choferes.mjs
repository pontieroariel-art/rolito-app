/**
 * import-choferes.mjs
 * Crea cuentas de choferes en Firebase Auth + Firestore y actualiza config/choferes.
 *
 * Uso:
 *   node scripts/import-choferes.mjs
 */

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import { readFileSync } from 'fs'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')

const serviceAccount = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const auth = admin.auth()
const db   = admin.firestore()

// ── Lista de choferes ─────────────────────────────────────────────────────────

const CHOFERES = [
  { nombre: 'Álvarez Sergio Jesús',       cuit: '20360242871' },
  { nombre: 'Diaz Agustin Santiago',      cuit: '20426171091' },
  { nombre: 'Gallo Braian Agustin',       cuit: '20393302128' },
  { nombre: 'Gerez Ricardo Fabián',       cuit: '20310116050' },
  { nombre: 'González Gustavo Adrián',    cuit: '23354647079' },
  { nombre: 'Jara Gabriel Antonio',       cuit: '20225803847' },
  { nombre: 'Marsicano Edgardo',          cuit: '20370331783' },
  { nombre: 'Molina Kevin Mauricio',      cuit: '20423149540' },
  { nombre: 'Morinigo Raul Martin',       cuit: '20323752134' },
  { nombre: 'Pereyra Gaston Sebastián',   cuit: '20351372509' },
  { nombre: 'Primiterra Cristian Osvaldo',cuit: '20256927110' },
]

async function main() {
  console.log(`Creando ${CHOFERES.length} choferes...\n`)

  const emails = []
  let created = 0, skipped = 0, errors = 0

  for (const chofer of CHOFERES) {
    const email    = `${chofer.cuit}@rolito.app`
    const password = chofer.cuit

    let uid
    try {
      const record = await auth.createUser({ email, password, displayName: chofer.nombre })
      uid = record.uid
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        const existing = await auth.getUserByEmail(email)
        uid = existing.uid
        skipped++
      } else {
        console.error(`  ERROR [${chofer.nombre}]: ${err.message}`)
        errors++
        continue
      }
    }

    await db.collection('users').doc(uid).set({
      nombre:         chofer.nombre,
      nombreContacto: chofer.nombre,
      email,
      cuit:           chofer.cuit,
      rol:            'chofer',
      estado:         'activo',
      phone:          '',
      address:        '',
      fechaCreacion:  admin.firestore.FieldValue.serverTimestamp(),
      aprobadoPor:    'importacion',
    }, { merge: true })

    emails.push(email)
    if (uid && skipped === 0 || (skipped > 0)) {
      if (!skipped || skipped === 0) created++
      else { created++ }
    }

    const status = uid ? (skipped > errors ? 'existente' : 'creado') : 'error'
    console.log(`  ${status === 'error' ? '✗' : '✓'} ${chofer.nombre} (${email})`)
  }

  // Actualizar config/choferes con todos los emails
  const configRef = db.collection('config').doc('choferes')
  const configSnap = await configRef.get()
  const existingEmails = configSnap.exists ? (configSnap.data().emails ?? []) : []
  const allEmails = [...new Set([...existingEmails, ...emails])]
  await configRef.set({ emails: allEmails })

  console.log(`\n── Resultado ────────────────────────────────`)
  console.log(`  Choferes procesados: ${CHOFERES.length}`)
  console.log(`  Emails en config/choferes: ${allEmails.length}`)
  console.log(`\n¡Listo!`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Error fatal:', err)
  process.exit(1)
})
