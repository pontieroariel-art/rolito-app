// Quién puede emitir un remito desde el muelle (2026-09-18).
//
// Con el circuito nuevo el remito lo emite MUELLE al entregar el camión. Eso
// convierte al muelle en el punto único de falla de las 4 de la mañana: si el
// turno no tiene con qué emitir, el camión no sale. Antes el remito ya existía.
//
// Por eso, antes de desplegar, todo el personal de muelle (de cualquier turno,
// incluidos los que cubren francos) necesita su propio usuario con planta
// cargada, la app instalada en su teléfono y un ensayo hecho. Este script dice
// quién está en condiciones y quién no.
//
// La planta es obligatoria para el rol físico: sin ella las reglas de expedición
// rechazan todo, y el muellero se entera recién cuando toca el botón.
//
//   node scripts/diagnosticar-muelle.mjs
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

const snap = await db.collection('users').get()
const deMuelle = snap.docs
  .map((d) => ({ uid: d.id, ...d.data() }))
  .filter((u) => u.rol === 'muelle' || (Array.isArray(u.rolesExtra) && u.rolesExtra.includes('muelle')))

console.log(`\nPersonal con rol muelle: ${deMuelle.length}\n`)

const listos = [], sinPlanta = [], inactivos = []
for (const u of deMuelle) {
  const fila = {
    nombre: u.nombre ?? '(sin nombre)',
    dni: u.dni ?? '(sin DNI)',
    planta: u.planta ?? null,
    rol: u.rol === 'muelle' ? 'principal' : 'adicional',
    estado: u.estado ?? '(sin estado)',
    // Sin suscripción push no sabemos si abrió la app en su teléfono; no es
    // prueba de que la instaló, pero un usuario que nunca la tuvo abierta no la
    // tiene seguro.
    abrioLaApp: !!u.pushSubscription?.endpoint,
  }
  if (u.estado !== 'activo') inactivos.push(fila)
  else if (!u.planta) sinPlanta.push(fila)
  else listos.push(fila)
}

const imprimir = (titulo, filas) => {
  if (!filas.length) return
  console.log(`${titulo} (${filas.length}):`)
  for (const f of filas) {
    console.log(`  ${f.nombre.padEnd(28)} DNI ${String(f.dni).padEnd(10)} ${String(f.planta ?? '—').padEnd(10)} rol ${f.rol.padEnd(10)} ${f.abrioLaApp ? 'abrió la app' : 'NUNCA abrió la app'}`)
  }
  console.log('')
}

imprimir('En condiciones de emitir', listos)
imprimir('SIN PLANTA: las reglas les rechazan todo', sinPlanta)
imprimir('No activos', inactivos)

const sinApp = listos.filter((f) => !f.abrioLaApp)
console.log('Antes de desplegar:')
console.log(`  ${sinPlanta.length ? `— Cargarle la planta a ${sinPlanta.length} persona(s).` : '— Todos tienen planta.'}`)
console.log(`  ${sinApp.length ? `— ${sinApp.length} persona(s) nunca abrieron la app: instalarla en su teléfono y hacer el login.` : '— Todos abrieron la app alguna vez.'}`)
console.log('  — Un ensayo de punta a punta por persona: aceptar un borrador desde el teléfono, con COT incluido.')
console.log('  — Dejar escrito quién es el contacto de guardia de madrugada.\n')
process.exit(0)
