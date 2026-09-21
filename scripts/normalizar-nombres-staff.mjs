/**
 * normalizar-nombres-staff.mjs — APELLIDO NOMBRE, todo en mayúscula (2026-09-20)
 *
 * Convención de Ariel: el nombre de todo usuario va en MAYÚSCULA y con el
 * APELLIDO PRIMERO. El alta nueva ya lo hace sola (CrearStaffModal); esto
 * arregla los 61 que ya estaban.
 *
 * Dos cosas distintas, y por eso el script:
 *   · MAYÚSCULA — mecánico, se aplica a todos.
 *   · DAR VUELTA apellido y nombre — NO se puede adivinar ("MURINEDDU CARLOS":
 *     el código no sabe cuál es cuál). Por eso va la lista explícita de abajo,
 *     revisada a ojo. El que no está en la lista, solo se pasa a mayúscula.
 *
 * OJO: `users.nombre` se IMPRIME (choferNombre en remitos y liquidaciones,
 * quién vendió en las leyendas de Tango). Cambiarlo cambia lo que sale en los
 * papeles nuevos; los ya emitidos guardan su copia y no se tocan.
 *
 * Uso:
 *   node scripts/normalizar-nombres-staff.mjs             # muestra antes → después, no escribe
 *   node scripts/normalizar-nombres-staff.mjs --aplicar
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')
const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

const APLICAR = process.argv.includes('--aplicar')

/**
 * Los que están NOMBRE APELLIDO y hay que dar vuelta. La clave es el nombre
 * exacto como está hoy; el valor, cómo tiene que quedar. Revisado a ojo sobre
 * el listado del 20/09 — si alguno está mal, se corrige acá y se vuelve a correr.
 */
const DAR_VUELTA = {
  'Alejandro pontiero':   'PONTIERO ALEJANDRO',
  'Ariel Orona':          'ORONA ARIEL',
  'Armando Mira':         'MIRA ARMANDO',
  'Brandon Gonzalez':     'GONZALEZ BRANDON',
  'Brian Escobar':        'ESCOBAR BRIAN',
  'Carlos Briozzo':       'BRIOZZO CARLOS',
  'Cristian Figueredo':   'FIGUEREDO CRISTIAN',
  'Cristian Gonzalez':    'GONZALEZ CRISTIAN',
  'Cristian Petti':       'PETTI CRISTIAN',
  'Daiana Villalba':      'VILLALBA DAIANA',
  'Daniel Andrae':        'ANDRAE DANIEL',
  'Fabian Romero':        'ROMERO FABIAN',
  'Fernanda Moreno':      'MORENO FERNANDA',
  'Fernando Parin':       'PARIN FERNANDO',
  'Ivan Almiron':         'ALMIRON IVAN',
  'Juan Cruz Vañek':      'VAÑEK JUAN CRUZ',
  'Lorena Santillan':     'SANTILLAN LORENA',
  'Lucas Garcia':         'GARCIA LUCAS',
  'Lucas Vazquez':        'VAZQUEZ LUCAS',
  'Matias Vinjoy':        'VINJOY MATIAS',
  'Mauro Pontiero':       'PONTIERO MAURO',
  'Maximiliano Gonzalez': 'GONZALEZ MAXIMILIANO',
  'Nicolas Diaz':         'DIAZ NICOLAS',
  'Vicente Valenzuela':   'VALENZUELA VICENTE',
  'Walter Giorgio':       'GIORGIO WALTER',
  'Walter Orona':         'ORONA WALTER',
  'Yanina Pontiero':      'PONTIERO YANINA',
}

/**
 * Los que NO toco porque no sé cuál es el apellido. Quedan en mayúscula como
 * están y Ariel decide:
 *   · 'Osvaldo Marcos'  → ¿MARCOS OSVALDO?  ('Marcos' puede ser apellido)
 *   · 'Franco Walter'   → ¿WALTER FRANCO?   (los dos sirven de apellido)
 * Y los que no son personas: 'Rolito', 'Tv Muelle Torcuato'.
 */
const DUDOSOS = ['Osvaldo Marcos', 'Franco Walter']

const txt = (v) => String(v ?? '').trim()

const snap = await db.collection('users').get()
const staff = snap.docs
  .map((d) => ({ uid: d.id, ...d.data() }))
  .filter((u) => u.rol && u.rol !== 'cliente')
  .sort((a, b) => txt(a.nombre).localeCompare(txt(b.nombre), 'es'))

const cambios = []
for (const u of staff) {
  const actual = txt(u.nombre)
  if (!actual) continue
  const nuevo = DAR_VUELTA[actual] ?? actual.toUpperCase()
  if (nuevo !== actual) cambios.push({ uid: u.uid, rol: txt(u.rol), actual, nuevo, vuelta: !!DAR_VUELTA[actual] })
}

console.log(`\n${APLICAR ? 'APLICANDO' : 'SIMULANDO (sin --aplicar no escribe nada)'} · ${cambios.length} de ${staff.length} usuarios cambian\n`)
for (const c of cambios) {
  console.log(`  ${c.vuelta ? '⟲' : ' '} ${c.actual.padEnd(32).slice(0, 32)} →  ${c.nuevo.padEnd(32).slice(0, 32)} ${c.rol}`)
}
const sinTocar = staff.filter((u) => DUDOSOS.includes(txt(u.nombre)))
if (sinTocar.length) {
  console.log('\n  Sin dar vuelta porque no sé cuál es el apellido (solo se pasan a mayúscula):')
  for (const u of sinTocar) console.log(`    ${txt(u.nombre)} (${txt(u.rol)})`)
}

if (!APLICAR) {
  console.log('\n  Revisá la columna de la derecha. Si hay alguno mal, se corrige la lista')
  console.log('  DAR_VUELTA del script y se vuelve a correr. Con --aplicar se escribe.\n')
  process.exit(0)
}

let hechos = 0
for (const c of cambios) {
  await db.doc(`users/${c.uid}`).update({ nombre: c.nuevo, nombreContacto: c.nuevo })
  hechos++
}
console.log(`\n  Listo: ${hechos} nombres actualizados.`)

// Los depósitos guardan una COPIA del nombre del usuario (`usuarioNombre`, la
// escribe la sync de depósitos). Sin refrescarla, la lista de Liquidación
// sigue mostrando el nombre viejo hasta la próxima sync. Se recalcula acá
// mismo, que es lo que haría la sync: nombre del usuario vinculado.
const porUid = new Map(staff.map((u) => [u.uid, txt(u.nombre)]))
const deps = await db.collection('depositosTango').get()
let refrescados = 0
for (const d of deps.docs) {
  const uid = txt(d.data().uid)
  if (!uid) continue
  const nombre = porUid.get(uid)
  if (!nombre || nombre === txt(d.data().usuarioNombre)) continue
  await d.ref.update({ usuarioNombre: nombre })
  refrescados++
}
console.log(`  Depósitos con el nombre refrescado: ${refrescados}.`)
console.log('  Los que salen de la descripción del depósito en Tango (ALMIRON 01,')
console.log('  CRISTIAN CURUCHET, SANTOS ALMIRON…) hay que cambiarlos allá.\n')
process.exit(0)
