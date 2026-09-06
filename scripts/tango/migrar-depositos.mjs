// Migración inicial del catálogo de depósitos (expedición por depósito de
// Tango, 2026-09-06): crea depositosTango/{codigo} a partir del export de
// Tango (scripts/tango/tango-tablas/depositos.company1.json) y vincula los
// usuarios de la app que ya estaban mapeados en config/tango.depositos
// (uid → código). Para los supervisores (que en Tango también son depósitos)
// propone el vínculo por nombre y lo aplica solo si es inequívoco.
//
// Después de esto el catálogo lo mantiene la sync (syncDepositosTango, 5:40)
// y los vínculos se editan desde Ajustes → Depósitos de reparto.
//
//   node scripts/tango/migrar-depositos.mjs            (dry-run: muestra qué haría)
//   node scripts/tango/migrar-depositos.mjs --commit

import { createRequire } from 'module'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const admin = require('../../functions/node_modules/firebase-admin/lib/index.js')
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))) })
const db = admin.firestore()
const COMMIT = process.argv.includes('--commit')

const PLANTAS = new Set(['01', '02'])
const INTERNOS = new Set(['26', '29', '81', '97', '98', '99'])
const tipoDefault = (cod) => (PLANTAS.has(cod) ? 'planta' : INTERNOS.has(cod) ? 'interno' : 'repartidor')
const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ')

const filas = JSON.parse(readFileSync(path.join(__dirname, 'tango-tablas', 'depositos.company1.json'), 'utf8'))
const cfg = (await db.doc('config/tango').get()).data() ?? {}
const uidPorCodigo = new Map(Object.entries(cfg.depositos ?? {}).map(([uid, cod]) => [String(cod), uid]))

const staff = await db.collection('users').where('rol', 'in', ['chofer', 'supervisor']).get()
const usuarios = staff.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => u.estado === 'activo' && u.subrol !== 'ayudante')
const nombreDe = (u) => u.nombre || u.nombreContacto || u.email || u.uid

const existentes = new Set((await db.collection('depositosTango').select().get()).docs.map((d) => d.id))
let nuevos = 0, vinculados = 0, propuestos = 0
const batch = db.batch()
for (const f of filas.slice().sort((a, b) => String(a.COD_STA22).localeCompare(String(b.COD_STA22), 'es', { numeric: true }))) {
  const codigo = String(f.COD_STA22).trim()
  const nombre = String(f.NOMBRE_SUC ?? '').trim()
  const tipo = tipoDefault(codigo)
  // Vínculo: primero el mapa config/tango.depositos; si no, un único usuario
  // activo cuyo nombre (normalizado, sin orden) coincida con el de Tango.
  let usuario = null
  const uidMapa = uidPorCodigo.get(codigo)
  if (uidMapa) usuario = usuarios.find((u) => u.uid === uidMapa) ?? null
  if (!usuario && tipo === 'repartidor') {
    const candidatos = usuarios.filter((u) => norm(nombreDe(u)) === norm(nombre))
    if (candidatos.length === 1) { usuario = candidatos[0]; propuestos++ }
  }
  const yaExiste = existentes.has(codigo)
  const linea = `${codigo.padEnd(3)} ${nombre.padEnd(28)} ${tipo.padEnd(10)} ${usuario ? `→ ${nombreDe(usuario)} (${usuario.rol})` : (tipo === 'repartidor' ? '(sin usuario)' : '')}${yaExiste ? '  [ya existía: solo vínculo]' : ''}`
  console.log(linea)
  if (!yaExiste) nuevos++
  if (usuario) vinculados++
  if (!COMMIT) continue
  const ref = db.doc(`depositosTango/${codigo}`)
  const base = { codigo, nombre, idSta22: Number(f.ID_STA22), inhabilitado: f.INHABILITA === true, actualizadoEn: admin.firestore.FieldValue.serverTimestamp() }
  const vinculo = usuario ? { uid: usuario.uid, usuarioNombre: nombreDe(usuario), usuarioRol: usuario.rol } : {}
  if (yaExiste) batch.set(ref, { ...base, ...vinculo }, { merge: true })
  else batch.set(ref, { ...base, tipo, activo: f.INHABILITA !== true, uid: null, usuarioNombre: null, usuarioRol: null, ...vinculo, creadoEn: admin.firestore.FieldValue.serverTimestamp() })
  // Espejo uid → código para los writers de Tango.
  if (usuario) batch.set(db.doc('config/tango'), { depositos: { [usuario.uid]: codigo } }, { merge: true })
}
if (COMMIT) await batch.commit()
console.log(`\n${COMMIT ? 'HECHO' : 'dry-run'}: ${filas.length} depósitos (${nuevos} nuevos), ${vinculados} con usuario vinculado (${propuestos} por coincidencia de nombre).`)
if (!COMMIT) console.log('Revisá los vínculos propuestos y corré con --commit. Después se ajusta lo que haga falta desde Ajustes → Depósitos.')
process.exit(0)
