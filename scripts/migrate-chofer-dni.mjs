/**
 * migrate-chofer-dni.mjs
 * Migra los choferes existentes al nuevo sistema de login por DNI.
 *
 * Lee todos los documentos de choferIndex (donde la clave es el CUIT),
 * extrae el DNI (8 dígitos del medio) y crea dniIndex/{dni} → { email, cuit }.
 *
 * Uso:
 *   node scripts/migrate-chofer-dni.mjs
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
const db = admin.firestore()

function dniFromCuit(cuit) {
  return cuit.replace(/\D/g, '').slice(2, 10)
}

async function main() {
  const snapshot = await db.collection('choferIndex').get()
  console.log(`Encontrados ${snapshot.size} choferes en choferIndex\n`)

  let ok = 0, errors = 0

  for (const docSnap of snapshot.docs) {
    const cuit  = docSnap.id
    const email = docSnap.data().email
    const dni   = dniFromCuit(cuit)

    if (!/^\d{11}$/.test(cuit)) {
      console.log(`  ⚠ Saltando clave no-CUIT: "${cuit}"`)
      continue
    }

    process.stdout.write(`  CUIT ${cuit} → DNI ${dni} (${email})... `)
    try {
      await db.collection('dniIndex').doc(dni).set({ email, cuit })
      // También actualizar el doc del usuario con el campo dni
      const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get()
      if (!usersSnap.empty) {
        await usersSnap.docs[0].ref.update({ dni, cuit })
      }
      console.log('✓')
      ok++
    } catch (err) {
      console.log(`✗ ${err.message}`)
      errors++
    }
  }

  console.log('\n── Resultado ────────────────────────────────')
  console.log(`  Migrados: ${ok}`)
  console.log(`  Errores:  ${errors}`)
  console.log('\nLos choferes ahora pueden ingresar con su DNI (8 dígitos del medio del CUIT).')
  process.exit(0)
}

main().catch((err) => {
  console.error('Error fatal:', err)
  process.exit(1)
})
