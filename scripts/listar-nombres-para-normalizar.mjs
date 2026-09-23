/**
 * listar-nombres-para-normalizar.mjs — los nombres como están hoy (2026-09-20)
 *
 * Ariel quiere que TODOS los nombres sean APELLIDO NOMBRE y en mayúscula. La
 * mayúscula y el orden alfabético ya se resuelven al mostrar; **dar vuelta
 * apellido y nombre no se puede adivinar**: en "MURINEDDU CARLOS" el código no
 * sabe cuál es cuál, y al revés queda peor que como está.
 *
 * Así que esto lista lo que hay, separado por de dónde sale cada nombre, y
 * marca los sospechosos de estar al revés (los que empiezan con un nombre de
 * pila común). Ariel marca cuáles dar vuelta y con eso se corrige el dato.
 *
 * Dos fuentes distintas, y cada una se corrige en su lugar:
 *   · users.nombre           → se arregla en la app (Usuarios)
 *   · descripción del depósito en Tango → se arregla en Tango
 *
 * SOLO LEE.
 *
 *   node scripts/listar-nombres-para-normalizar.mjs
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('./lib/firebase-admin-compat.cjs')
const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

const txt = (v) => String(v ?? '').trim()

// Nombres de pila frecuentes en el plantel. Si el nombre EMPIEZA con uno de
// éstos, probablemente esté al revés. Es una pista para revisar, no una regla.
const PILA = new Set([
  'JUAN', 'JOSE', 'CARLOS', 'MARIA', 'LUIS', 'JORGE', 'MIGUEL', 'ANGEL', 'ROBERTO', 'DANIEL',
  'MARIO', 'RICARDO', 'SERGIO', 'GUSTAVO', 'WALTER', 'DIEGO', 'PABLO', 'MARTIN', 'ARIEL',
  'CRISTIAN', 'MATIAS', 'LEONARDO', 'DELFINO', 'SANTOS', 'DAMIAN', 'MAXIMILIANO', 'IVAN',
  'ARMANDO', 'GABRIEL', 'ALEJANDRO', 'BRANDON', 'JONATAN', 'RAUL', 'OSVALDO', 'ANTONIO',
  'FABIAN', 'AGUSTIN', 'BRAIAN', 'NICOLAS', 'FRANCO', 'HUGO', 'OSCAR', 'RUBEN', 'CLAUDIO',
  'MARCELO', 'FERNANDO', 'ADRIAN', 'JAVIER', 'ALBERTO', 'EDUARDO', 'RODRIGO', 'EZEQUIEL',
])

const sinTildes = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
const empiezaConPila = (nombre) => PILA.has(sinTildes(nombre).split(/\s+/)[0] ?? '')
const marca = (nombre) => {
  const n = txt(nombre)
  if (!n) return '   '
  if (empiezaConPila(n)) return ' ⟲ '        // sospechoso de estar al revés
  if (n !== n.toUpperCase()) return ' aA'     // no está en mayúscula
  return '   '
}

// ── 1. Staff de la app ───────────────────────────────────────────────────────
const users = await db.collection('users').get()
const staff = users.docs
  .map((d) => ({ uid: d.id, ...d.data() }))
  .filter((u) => u.rol && u.rol !== 'cliente')
  .sort((a, b) => txt(a.nombre).localeCompare(txt(b.nombre), 'es'))

console.log(`\n══ USUARIOS DE LA APP (se corrigen en Usuarios): ${staff.length}\n`)
console.log('     nombre                                   rol                 DNI')
for (const u of staff) {
  console.log(`${marca(u.nombre)}  ${txt(u.nombre).padEnd(40).slice(0, 40)} ${txt(u.rol).padEnd(20)} ${txt(u.dni)}`)
}

// ── 2. Depósitos de reparto (el nombre viene de Tango si no hay usuario) ─────
const deps = await db.collection('depositosTango').get()
const reparto = deps.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((d) => d.tipo === 'repartidor' && d.activo && !d.inhabilitado)
  .sort((a, b) => txt(a.usuarioNombre || a.nombre).localeCompare(txt(b.usuarioNombre || b.nombre), 'es'))

console.log(`\n══ REPARTIDORES (la lista de Liquidación): ${reparto.length}\n`)
console.log('     cód  nombre que se muestra                    de dónde sale')
for (const d of reparto) {
  const nombre = txt(d.usuarioNombre) || txt(d.nombre)
  const fuente = txt(d.usuarioNombre) ? 'usuario de la app' : 'descripción en Tango'
  console.log(`${marca(nombre)}  ${txt(d.codigo).padStart(3)}  ${nombre.padEnd(40).slice(0, 40)} ${fuente}`)
}

console.log('\n  ⟲ = empieza con un nombre de pila: probablemente esté NOMBRE APELLIDO')
console.log('  aA = no está todo en mayúscula en el dato (en pantalla ya se ve en mayúscula)')
console.log('\n  Los de "usuario de la app" los corrijo yo con un script; los de')
console.log('  "descripción en Tango" hay que cambiarlos en Tango.\n')

process.exit(0)
