/**
 * cleanup-db.mjs
 * Borra todos los datos de prueba de Firestore y Firebase Auth,
 * conservando únicamente al usuario Ariel Pontiero (super_admin).
 *
 * Uso:
 *   node --experimental-vm-modules scripts/cleanup-db.mjs
 *
 * Requiere: scripts/serviceAccount.json (clave de servicio de Firebase)
 */

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const admin = require('../functions/node_modules/firebase-admin/lib/index.js')
const serviceAccount = require('./serviceAccount.json')

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const db   = admin.firestore()
const auth = admin.auth()

const ARIEL_UID   = 'egyoWGGO6GfOxZYWldPIA8f6lFr2'
const ARIEL_DOC   = {
  address:        '',
  aprobadoPor:    null,
  email:          'pontieroariel@gmail.com',
  estado:         'activo',
  fechaAprobacion: null,
  fechaCreacion:  admin.firestore.Timestamp.fromDate(new Date('2026-05-10T22:04:46.243Z')),
  nombre:         'Rolito',
  phone:          '',
  rol:            'super_admin',
}

// ── Borrar colección en batches ───────────────────────────────────────────────

async function deleteCollection(colName) {
  let deleted = 0
  while (true) {
    const snap = await db.collection(colName).limit(400).get()
    if (snap.empty) break
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
    deleted += snap.size
    process.stdout.write(`\r  ${colName}: ${deleted} borrados...`)
  }
  console.log(`\r  ${colName}: ${deleted} borrados. ✓`)
}

// ── Borrar usuarios de Firebase Auth (excepto Ariel) ─────────────────────────

async function deleteAuthUsers() {
  let nextPageToken
  let deleted = 0
  do {
    const result = await auth.listUsers(1000, nextPageToken)
    const toDelete = result.users
      .filter((u) => u.uid !== ARIEL_UID)
      .map((u) => u.uid)

    if (toDelete.length > 0) {
      await auth.deleteUsers(toDelete)
      deleted += toDelete.length
      process.stdout.write(`\r  Auth users: ${deleted} borrados...`)
    }
    nextPageToken = result.pageToken
  } while (nextPageToken)

  console.log(`\r  Auth users: ${deleted} borrados. ✓`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🧹 Limpiando base de datos...\n')

  // Borrar colecciones
  const colecciones = ['users', 'orders', 'despachos', 'ubicaciones', 'cuitIndex']
  for (const col of colecciones) {
    await deleteCollection(col)
  }

  // Restaurar documento de Ariel
  await db.collection('users').doc(ARIEL_UID).set(ARIEL_DOC)
  console.log('  Ariel Pontiero restaurado. ✓')

  // Borrar cuentas de Auth
  console.log('')
  await deleteAuthUsers()

  console.log('\n✅ Listo. Base de datos limpia.')
  console.log('   Solo queda Ariel Pontiero como super_admin.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
