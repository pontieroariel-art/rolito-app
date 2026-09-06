/**
 * Rota la contraseña del usuario de servicio del bridge (tango-bridge@rolito.internal)
 * en Firebase Auth y revoca sus sesiones vivas. Genera una contraseña aleatoria
 * larga y la imprime UNA sola vez: guardarla en Bitwarden y pegarla en
 * C:\RolitoSync\sql\bridge-sql.config.json (tangoBridgePassword) del servidor
 * RHIELOTG, y reiniciar la tarea RolitoBridgeSql.
 *
 * Uso (desde la raíz del repo, con scripts/serviceAccount.json presente):
 *   node scripts/tango/cambiar-pass-bridge.mjs [email]
 */
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { randomBytes } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const admin = require('../../functions/node_modules/firebase-admin/lib/index.js')

const email = process.argv[2] ?? 'tango-bridge@rolito.internal'

const serviceAccount = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })

// 32 bytes → 43 chars base64url: letras, números, '-' y '_' (sin comillas ni backslash,
// se pega tal cual en el JSON del servidor).
const password = randomBytes(32).toString('base64url')

const auth = admin.auth()
const user = await auth.getUserByEmail(email)
await auth.updateUser(user.uid, { password })
await auth.revokeRefreshTokens(user.uid)

console.log(`Contraseña cambiada para ${email} (uid ${user.uid}); sesiones anteriores revocadas.`)
console.log('Nueva contraseña (guardar en Bitwarden y pegar en bridge-sql.config.json):')
console.log(password)
