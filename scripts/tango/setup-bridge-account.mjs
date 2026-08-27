/**
 * setup-bridge-account.mjs
 *
 * Script one-off: crea la cuenta de servicio que usa scripts/tango/bridge-listener.mjs
 * para escuchar tango-outbox en tiempo real. Es un usuario real de Firebase Auth
 * (nunca loguea por la UI de la app) + un doc users/{uid} con `tangoBridge: true`
 * (así lo reconoce isTangoBridge() en firestore.rules, sin tocar el enum UserRole
 * ni la navegación de la app). Ver docs/tango/INTEGRACION.md §7.
 *
 * Uso (una sola vez por ambiente):
 *   node scripts/tango/setup-bridge-account.mjs <email> <password>
 *
 * Contra el emulador (para probar el flujo end-to-end):
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *     node scripts/tango/setup-bridge-account.mjs tango-bridge@rolito.internal cualquier-cosa
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')

const [, , email, password] = process.argv
if (!email || !password) {
  console.error('Uso: node scripts/tango/setup-bridge-account.mjs <email> <password>')
  process.exit(1)
}

const usandoEmulador = !!process.env.FIRESTORE_EMULATOR_HOST

if (usandoEmulador) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-rolito' })
} else {
  const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json')
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
}

async function main() {
  const auth = admin.auth()
  const db = admin.firestore()

  let user
  try {
    user = await auth.getUserByEmail(email)
    console.log(`Ya existe la cuenta ${email} (uid ${user.uid}) — no se recrea.`)
  } catch {
    user = await auth.createUser({ email, password })
    console.log(`Cuenta creada: ${email} (uid ${user.uid})`)
  }

  await db.collection('users').doc(user.uid).set({ tangoBridge: true }, { merge: true })
  console.log(`users/${user.uid} marcado con tangoBridge: true`)
}

main().catch((err) => {
  console.error('ERROR:', err)
  process.exit(1)
})
