/**
 * delete-user.mjs
 * Borra un usuario por nombre de todos lados: Firestore users, Auth, y índices.
 * Uso: node scripts/delete-user.mjs "Alejandro Pontiero"
 */

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import { readFileSync } from 'fs'

const require     = createRequire(import.meta.url)
const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const admin       = require('../functions/node_modules/firebase-admin/lib/index.js')

const serviceAccount = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db   = admin.firestore()
const auth = admin.auth()

const NOMBRE_BUSCAR = process.argv[2] || 'Alejandro Pontiero'

async function main() {
  console.log(`\nBuscando usuarios con nombre: "${NOMBRE_BUSCAR}"\n`)

  // Buscar en users por nombre y nombreContacto
  const [byNombre, byContacto] = await Promise.all([
    db.collection('users').where('nombre', '==', NOMBRE_BUSCAR).get(),
    db.collection('users').where('nombreContacto', '==', NOMBRE_BUSCAR).get(),
  ])

  const docsMap = new Map()
  for (const snap of [byNombre, byContacto]) {
    for (const d of snap.docs) docsMap.set(d.id, d)
  }

  if (docsMap.size === 0) {
    console.log('  No se encontró ningún usuario con ese nombre.')
    process.exit(0)
  }

  for (const [uid, docSnap] of docsMap) {
    const data = docSnap.data()
    console.log(`  Encontrado: uid=${uid}`)
    console.log(`    email:    ${data.email}`)
    console.log(`    emailAuth:${data.emailAuth ?? '(igual a email)'}`)
    console.log(`    rol:      ${data.rol}`)
    console.log(`    dni:      ${data.dni ?? '-'}`)
    console.log(`    cuit:     ${data.cuit ?? '-'}`)

    const emailAuth = data.emailAuth || data.email

    // 1. Borrar de Firebase Auth
    try {
      const userRecord = await auth.getUserByEmail(emailAuth)
      await auth.deleteUser(userRecord.uid)
      console.log(`  ✓ Auth eliminado (${emailAuth})`)
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        console.log(`  ⚠ Auth: usuario no encontrado (${emailAuth})`)
      } else {
        console.log(`  ✗ Auth error: ${e.message}`)
      }
    }

    // 2. Borrar documento users/{uid}
    await docSnap.ref.delete()
    console.log(`  ✓ Firestore users/${uid} eliminado`)

    // 3. Borrar de índices según rol
    if (data.rol === 'chofer' && data.cuit) {
      const cuit = data.cuit.replace(/\D/g, '')
      const dni  = cuit.slice(2, 10)
      await Promise.allSettled([
        db.collection('choferIndex').doc(cuit).delete(),
        db.collection('dniIndex').doc(dni).delete(),
      ])
      console.log(`  ✓ Índices chofer eliminados (cuit=${cuit}, dni=${dni})`)
    }

    if (['super_admin','gerente_comercial','comercial','logistica','facturacion'].includes(data.rol) && data.dni) {
      const dni = data.dni.replace(/\D/g, '')
      await db.collection('staffDniIndex').doc(dni).delete()
      console.log(`  ✓ staffDniIndex/${dni} eliminado`)
    }

    if (data.rol === 'cliente' && data.cuit) {
      await db.collection('cuitIndex').doc(data.cuit.replace(/\D/g, '')).delete()
      console.log(`  ✓ cuitIndex eliminado`)
    }

    console.log('')
  }

  console.log('── Listo ──')
  process.exit(0)
}

main().catch((err) => {
  console.error('Error fatal:', err)
  process.exit(1)
})
