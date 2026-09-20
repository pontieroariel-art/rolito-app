/**
 * crear-muelleros.mjs
 * Alta del personal de muelle de Planta Don Torcuato — lista pasada por Ariel
 * el 2026-09-20, para el estreno del circuito en el que el remito de carga lo
 * emite MUELLE al entregar el camión (antes lo emitía caja, que venía
 * cubriendo el puesto con el rol adicional).
 *
 * Login de staff: DNI (8 dígitos) + contraseña, contra `staffDniIndex`
 * (src/services/staffAuthService.ts). El staff NO lleva CUIT/CUIL: la app
 * guarda `cuit: ''` a propósito, el CUIL es de los choferes y los clientes.
 *
 * La PLANTA es obligatoria: muelle es un rol físico y sin ella las reglas de
 * expedición le rechazan todo, y el muellero se entera recién al tocar el botón.
 *
 * Escribe los mismos campos que `createStaffUser` (src/services/userService.ts);
 * si esa función cambia, este script también.
 *
 * Idempotente: si el DNI ya está en `staffDniIndex`, lo saltea sin tocar nada.
 * Cada uno recibe una contraseña aleatoria que el script imprime UNA vez, para
 * comunicársela; no queda nada escrito en el repo.
 *
 * Uso (contra PRODUCCIÓN — pedir antes):
 *   node scripts/crear-muelleros.mjs            # dice qué haría, sin escribir
 *   node scripts/crear-muelleros.mjs --aplicar  # crea los usuarios
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

const APLICAR = process.argv.includes('--aplicar')

const PLANTA = 'torcuato'
const ROL    = 'muelle'

// APELLIDO, NOMBRE y en mayúsculas (convención de Ariel, 2026-09-20): es como
// los lista Tango y como se busca a alguien en un listado de cien personas.
const MUELLEROS = [
  { nombre: 'CASCO UBALDO, GABRIEL',        dni: '36809554' },
  { nombre: 'PEREYRA, DIEGO',               dni: '34648980' },
  { nombre: 'GONZALEZ CARRARA, ALEJANDRO',  dni: '40227817' },
  { nombre: 'VAZQUEZ, BRANDON ALEXANDER',   dni: '42291861' },
  { nombre: 'FIGUEROA, JONATAN RUBEN',      dni: '33061267' },
]

const dniToStaffEmail = (dni) => `${dni.replace(/\D/g, '')}@staff.rolito.internal`

// Contraseña de estreno: 10 caracteres sin los que se confunden al dictarla
// por teléfono (0/O, 1/l/I). La cambian ellos después.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const nuevaPassword = () =>
  Array.from({ length: 10 }, () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)]).join('')

async function crear({ nombre, dni }) {
  const normalizado = dni.replace(/\D/g, '')
  if (normalizado.length !== 8) {
    console.log(`  ERROR ${nombre} — el DNI "${dni}" no tiene 8 dígitos`)
    return
  }
  const email = dniToStaffEmail(normalizado)

  // Mismo cuidado que la app: si el DNI ya es de otra cuenta, pisar el índice
  // la deja sin poder loguearse.
  const indice = await db.collection('staffDniIndex').doc(normalizado).get()
  if (indice.exists) {
    const yaUsado = indice.data().email
    if (yaUsado === email) console.log(`  SKIP ${nombre} (DNI ${normalizado}) — ya existe`)
    else console.log(`  ERROR ${nombre} (DNI ${normalizado}) — ese DNI ya es de ${yaUsado}`)
    return
  }

  if (!APLICAR) {
    console.log(`  crearía ${nombre.padEnd(30)} DNI ${normalizado}  rol ${ROL}  planta ${PLANTA}`)
    return
  }

  const password = nuevaPassword()
  let uid
  try {
    const user = await auth.createUser({ email, password, displayName: nombre })
    uid = user.uid
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      // La cuenta de Auth quedó de un intento anterior: se reusa y se le pone
      // la contraseña nueva, así el índice y el doc quedan consistentes.
      const existing = await auth.getUserByEmail(email)
      uid = existing.uid
      await auth.updateUser(uid, { password, displayName: nombre })
    } else {
      throw err
    }
  }

  await db.collection('users').doc(uid).set({
    nombre,
    email,
    dni:             normalizado,
    phone:           '',
    rol:             ROL,
    planta:          PLANTA,
    estado:          'activo',
    address:         '',
    razonSocial:     '',
    nombreContacto:  nombre,
    cuit:            '',
    telefono:        '',
    addresses:       [],
    fechaCreacion:   admin.firestore.FieldValue.serverTimestamp(),
    fechaAprobacion: admin.firestore.FieldValue.serverTimestamp(),
    aprobadoPor:     'admin',
  })

  await db.collection('staffDniIndex').doc(normalizado).set({ email })

  console.log(`  OK ${nombre.padEnd(30)} DNI ${normalizado}  contraseña ${password}`)
}

async function main() {
  console.log(`\n${APLICAR ? 'Creando' : 'SIMULANDO (sin --aplicar no escribe nada)'} ${MUELLEROS.length} usuarios de muelle en Planta Don Torcuato\n`)
  for (const m of MUELLEROS) await crear(m)
  console.log(
    APLICAR
      ? '\nListo. Anotá las contraseñas ahora: no se vuelven a mostrar.\n'
      : '\nVolvé a correrlo con --aplicar para crearlos.\n',
  )
}

main().catch((err) => {
  console.error('ERROR:', err)
  process.exit(1)
})
