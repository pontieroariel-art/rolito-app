/**
 * vincular-depositos-usuarios.mjs — repara el vínculo usuario ↔ depósito de Tango.
 *
 * El 2026-09-10 se dieron de alta choferes con sincronizar-choferes-tango.mjs
 * (users.depositoTango + config/tango.depositos) pero el catálogo nuevo
 * depositosTango/{codigo}.uid quedó en null. Caja emitía los remitos de carga
 * con la identidad sintética `dep:13` y el chofer (que consulta por su uid)
 * no veía nada en su home ni en "Mi camión hoy".
 *
 *   1. depositosTango/{cod}.uid/usuarioNombre/usuarioRol ← users con depositoTango
 *   2. remitosCarga / descargasCamion / liquidaciones / cambiosCamion con
 *      choferId `dep:<cod>` pasan al uid del usuario vinculado.
 *
 * Uso:  node scripts/tango/vincular-depositos-usuarios.mjs            → dry-run
 *       node scripts/tango/vincular-depositos-usuarios.mjs --commit
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')
const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
const { FieldValue } = admin.firestore
const COMMIT = process.argv.includes('--commit')

// 1) Vincular en el catálogo depositosTango los usuarios que ya tienen users.depositoTango
const users = (await db.collection('users').get()).docs.filter(d => d.data().depositoTango)
const porCodigo = new Map()
for (const u of users) {
  const x = u.data(); const cod = String(x.depositoTango).padStart(2, '0')
  const ref = db.doc(`depositosTango/${cod}`); const dep = (await ref.get()).data()
  if (!dep) { console.log('sin doc depositosTango', cod); continue }
  porCodigo.set(cod, u.id)
  if (dep.uid === u.id) { console.log('OK', cod, x.nombre); continue }
  console.log('VINCULAR', cod, dep.nombre, '→', u.id, x.nombre, x.rol)
  if (COMMIT) await ref.update({ uid: u.id, usuarioNombre: x.nombre, usuarioRol: x.rol, editadoEn: FieldValue.serverTimestamp() })
}
// 2) Migrar docs con identidad sintética dep:<cod> al uid del usuario vinculado
for (const c of ['remitosCarga', 'descargasCamion', 'liquidaciones', 'cambiosCamion']) {
  const s = await db.collection(c).get()
  for (const d of s.docs) {
    const id = String(d.data().choferId ?? '')
    if (!id.startsWith('dep:')) continue
    const uid = porCodigo.get(id.slice(4))
    if (!uid) { console.log(c, d.id, id, 'sin usuario: se deja'); continue }
    console.log('MIGRAR', c, d.data().codigo ?? d.id, id, '→', uid)
    if (COMMIT) await d.ref.update({ choferId: uid })
  }
}
console.log(COMMIT ? 'APLICADO' : 'DRY-RUN')
process.exit(0)
