/**
 * setup-chofer-auth.mjs
 * Configura el login de choferes con nombre de usuario + PIN.
 *
 * Para cada chofer:
 *  - Actualiza la contraseña en Firebase Auth a PIN "1234" (formato: "1234__ch")
 *  - Crea el índice choferIndex/{nombre.normalizado} → email
 *  - Guarda el campo `username` en el documento de Firestore
 *
 * Uso:
 *   node scripts/setup-chofer-auth.mjs
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

// ── Misma lógica que choferAuthService.ts ─────────────────────────────────────

function normalizeUsername(nombre) {
  return nombre.trim().toLowerCase().replace(/\s+/g, '.')
}

function padPin(pin) {
  return `${pin}__ch`
}

// ── Lista de choferes ─────────────────────────────────────────────────────────

const CHOFERES = [
  { nombre: 'Álvarez Sergio Jesús',        cuit: '20360242871' },
  { nombre: 'Diaz Agustin Santiago',       cuit: '20426171091' },
  { nombre: 'Gallo Braian Agustin',        cuit: '20393302128' },
  { nombre: 'Gerez Ricardo Fabián',        cuit: '20310116050' },
  { nombre: 'González Gustavo Adrián',     cuit: '23354647079' },
  { nombre: 'Jara Gabriel Antonio',        cuit: '20225803847' },
  { nombre: 'Marsicano Edgardo',           cuit: '20370331783' },
  { nombre: 'Molina Kevin Mauricio',       cuit: '20423149540' },
  { nombre: 'Morinigo Raul Martin',        cuit: '20323752134' },
  { nombre: 'Pereyra Gaston Sebastián',    cuit: '20351372509' },
  { nombre: 'Primiterra Cristian Osvaldo', cuit: '20256927110' },
]

const PIN      = '1234'
const PASSWORD = padPin(PIN)

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Configurando login para ${CHOFERES.length} choferes...`)
  console.log(`PIN: ${PIN}  →  contraseña: ${PASSWORD}\n`)

  let ok = 0, errors = 0

  for (const chofer of CHOFERES) {
    const email        = `${chofer.cuit}@rolito.app`
    const username     = chofer.cuit                          // CUIT como username
    const oldUsername  = normalizeUsername(chofer.nombre)    // entrada vieja a eliminar

    process.stdout.write(`  ${chofer.nombre} (${username})... `)

    try {
      // 1. Buscar UID en Firebase Auth
      const userRecord = await auth.getUserByEmail(email)
      const uid = userRecord.uid

      // 2. Actualizar contraseña
      await auth.updateUser(uid, { password: PASSWORD })

      // 3. Eliminar índice viejo por nombre (si existe)
      await db.collection('choferIndex').doc(oldUsername).delete()

      // 4. Crear índice por CUIT
      await db.collection('choferIndex').doc(username).set({ email })

      // 5. Guardar username en el documento del usuario
      await db.collection('users').doc(uid).update({ username })

      console.log('✓')
      ok++
    } catch (err) {
      console.log(`✗ ${err.message}`)
      errors++
    }
  }

  console.log('\n── Resultado ────────────────────────────────')
  console.log(`  Configurados: ${ok}`)
  console.log(`  Errores:      ${errors}`)
  console.log('\nCredenciales de acceso:')
  console.log('  Usuario: CUIT (ej: 20360242871)')
  console.log(`  PIN:     ${PIN}`)
  console.log('\n¡Listo!')
  process.exit(0)
}

main().catch((err) => {
  console.error('Error fatal:', err)
  process.exit(1)
})
