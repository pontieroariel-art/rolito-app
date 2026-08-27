/**
 * crear-operarios-produccion.mjs
 * Alta masiva de operarios de producción (login por legajo, ver
 * src/services/produccionAuthService.ts) — lista pasada por Ariel el 2026-08-27,
 * todos de Planta Don Torcuato.
 *
 * Uso:
 *   node scripts/crear-operarios-produccion.mjs
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccount.json')
const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })

const db   = admin.firestore()
const auth = admin.auth()

// Mismos valores que src/services/produccionAuthService.ts — si cambia ahí,
// cambiar acá también.
const PASSWORD_FIJA = 'rolito-produccion-legajo'
const legajoToEmail = (legajo) => `${legajo}@produccion.rolito.internal`

function tituloCase(nombreCompleto) {
  return nombreCompleto
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

const PLANTA = 'torcuato'
const OPERARIOS = [
  { nombre: 'ORELLANA CARLOS',      legajo: '5530' },
  { nombre: 'SAAVEDRA DAMIAN',      legajo: '5808' },
  { nombre: 'DE PASQUALE NICOLAS',  legajo: '5805' },
  { nombre: 'RIVEROS FRANK',        legajo: '5780' },
  { nombre: 'SANTILLAN RODRIGO',    legajo: '5779' },
  { nombre: 'LOPEZ FLAVIO',         legajo: '5643' },
  { nombre: 'MEDERO AGUSTIN',       legajo: '5724' },
  { nombre: 'ACUÑA JULIAN',         legajo: '5596' },
  { nombre: 'GRANEROS ADRIAN',      legajo: '5803' },
  { nombre: 'CARRIZO MARCELO',      legajo: '5797' },
  { nombre: 'PIRIS ENZO',           legajo: '5795' },
  { nombre: 'DIAZ JUAN JOSE',       legajo: '5721' },
  { nombre: 'FRANCO WALTER',        legajo: '5731' },
]

async function crearOperario({ nombre, legajo }) {
  const nombreContacto = tituloCase(nombre)
  const email = legajoToEmail(legajo)

  const yaExiste = await db.collection('produccionLegajoIndex').doc(legajo).get()
  if (yaExiste.exists) {
    console.log(`  SKIP ${nombreContacto} (legajo ${legajo}) — ya existe`)
    return
  }

  let uid
  try {
    const user = await auth.createUser({ email, password: PASSWORD_FIJA, displayName: nombreContacto })
    uid = user.uid
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      const existing = await auth.getUserByEmail(email)
      uid = existing.uid
    } else {
      throw err
    }
  }

  await db.collection('users').doc(uid).set({
    nombre:          nombreContacto,
    nombreContacto,
    email,
    planta:          PLANTA,
    legajo,
    phone:           '',
    rol:             'produccion_hielo',
    estado:          'activo',
    address:         '',
    razonSocial:     '',
    cuit:            '',
    telefono:        '',
    addresses:       [],
    fechaCreacion:   admin.firestore.FieldValue.serverTimestamp(),
    fechaAprobacion: admin.firestore.FieldValue.serverTimestamp(),
    aprobadoPor:     'admin',
  })

  await db.collection('produccionLegajoIndex').doc(legajo).set({ email })

  console.log(`  OK ${nombreContacto} (legajo ${legajo})`)
}

async function main() {
  console.log(`Creando ${OPERARIOS.length} operarios en Planta Don Torcuato...`)
  for (const op of OPERARIOS) {
    await crearOperario(op)
  }
  console.log('Listo.')
}

main().catch((err) => {
  console.error('ERROR:', err)
  process.exit(1)
})
