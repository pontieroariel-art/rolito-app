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
 * La contraseña de estreno es el propio DNI (decisión de Ariel, 2026-09-20).
 *
 * Uso (contra PRODUCCIÓN — pedir antes):
 *   node scripts/crear-muelleros.mjs            # dice qué haría, sin escribir
 *   node scripts/crear-muelleros.mjs --aplicar  # crea los que falten
 *   node scripts/crear-muelleros.mjs --aplicar --resetear-password
 *                                               # además, a los que ya existen
 *                                               # les pone la contraseña = su DNI
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('./lib/firebase-admin-compat.cjs')

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccount.json')
const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })

const db   = admin.firestore()
const auth = admin.auth()

const APLICAR  = process.argv.includes('--aplicar')
// Le pone a los que ya existen la contraseña = su DNI. Aparte de --aplicar a
// propósito: pisar la clave de alguien que ya la cambió no puede pasar por
// volver a correr el script.
const RESETEAR = process.argv.includes('--resetear-password')

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

// Contraseña de estreno: el propio DNI (decisión de Ariel, 2026-09-20). No hay
// clave que dictar ni que se pierda el primer día. OJO: el DNI es TAMBIÉN el
// usuario, así que quien lo sepa entra como esa persona, y muelle emite remitos
// y cuenta descargas. Es para arrancar; que cada uno la cambie después.
const passwordDe = (dni) => dni

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
    if (yaUsado !== email) {
      console.log(`  ERROR ${nombre} (DNI ${normalizado}) — ese DNI ya es de ${yaUsado}`)
      return
    }
    // Ya existe. Solo se le toca la contraseña si se pide expresamente: un
    // re-run del script no puede dejar afuera a alguien que ya cambió la suya.
    if (!RESETEAR) {
      console.log(`  SKIP ${nombre} (DNI ${normalizado}) — ya existe`)
      return
    }
    if (!APLICAR) {
      console.log(`  resetearía la contraseña de ${nombre.padEnd(30)} DNI ${normalizado}`)
      return
    }
    const existente = await auth.getUserByEmail(email)
    await auth.updateUser(existente.uid, { password: passwordDe(normalizado) })
    console.log(`  OK ${nombre.padEnd(30)} DNI ${normalizado}  contraseña = su DNI`)
    return
  }

  if (!APLICAR) {
    console.log(`  crearía ${nombre.padEnd(30)} DNI ${normalizado}  rol ${ROL}  planta ${PLANTA}`)
    return
  }

  const password = passwordDe(normalizado)
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

  console.log(`  OK ${nombre.padEnd(30)} DNI ${normalizado}  contraseña = su DNI`)
}

async function main() {
  console.log(`\n${APLICAR ? 'Creando' : 'SIMULANDO (sin --aplicar no escribe nada)'} ${MUELLEROS.length} usuarios de muelle en Planta Don Torcuato\n`)
  for (const m of MUELLEROS) await crear(m)
  console.log(
    APLICAR
      ? '\nListo. Cada uno entra con su DNI como usuario Y como contraseña.\n'
      : '\nVolvé a correrlo con --aplicar para crearlos.\n',
  )
}

main().catch((err) => {
  console.error('ERROR:', err)
  process.exit(1)
})
