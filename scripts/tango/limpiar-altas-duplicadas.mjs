// Limpieza puntual (2026-09-06): la primera corrida de altas automáticas
// (tangoAltas.ts) corrió en paralelo desde el barrido programado y desde el
// botón del panel; como Firebase Auth del proyecto permite varias cuentas con
// el mismo email, 140 CUIT quedaron con DOS fichas y DOS usuarios de Auth.
// Este script conserva la copia que registró la cola tango-altas (o la más
// vieja) y borra la otra — solo si es una cuenta creada por la sync
// (aprobadoPor 'tango', email @rolito.app) y sin pedidos. Idempotente.
//
//   node scripts/tango/limpiar-altas-duplicadas.mjs            (dry-run)
//   node scripts/tango/limpiar-altas-duplicadas.mjs --borrar
//
// El bug se corrigió en tangoAltas.ts (reclamo atómico del doc de la cola +
// reuso del usuario de Auth si el email ya existe).

import { createRequire } from 'module'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const admin = require('../../functions/node_modules/firebase-admin/lib/index.js')
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))) })
const db = admin.firestore()
const auth = admin.auth()
const BORRAR = process.argv.includes('--borrar')

const us = await db.collection('users').where('rol', '==', 'cliente').where('aprobadoPor', '==', 'tango').get()
const porCuit = new Map()
for (const d of us.docs) {
  const c = String(d.data().cuit ?? '').replace(/\D/g, '')
  porCuit.set(c, (porCuit.get(c) ?? []).concat(d))
}

let borrados = 0, conservados = 0, raros = 0
for (const [cuit, docs] of porCuit) {
  if (docs.length < 2) continue
  const alta = (await db.doc(`tango-altas/${cuit}`).get()).data()
  const porFecha = docs.slice().sort((a, b) => (a.data().fechaCreacion?.toMillis?.() ?? 0) - (b.data().fechaCreacion?.toMillis?.() ?? 0))
  const keep = docs.find((d) => d.id === alta?.uid) ?? porFecha[0]
  for (const d of docs) {
    if (d.id === keep.id) { conservados++; continue }
    const u = d.data()
    if (u.aprobadoPor !== 'tango' || u.ultimoPedidoAt || !String(u.emailAuth ?? '').endsWith('@rolito.app')) {
      raros++
      console.log('NO se borra (revisar a mano):', cuit, d.id, u.razonSocial)
      continue
    }
    console.log(`${BORRAR ? 'borro' : 'borraría'} ${cuit} ${u.razonSocial} uid=${d.id} (se conserva ${keep.id})`)
    if (BORRAR) {
      await auth.deleteUser(d.id).catch((e) => console.log('  auth:', e.code))
      await d.ref.delete()
    }
    borrados++
  }
  if (BORRAR) {
    if (alta?.uid !== keep.id) await db.doc(`tango-altas/${cuit}`).set({ uid: keep.id }, { merge: true })
    await db.doc(`cuitIndex/${cuit}`).set({ email: keep.data().emailAuth })
  }
}
console.log({ modo: BORRAR ? 'BORRADO' : 'dry-run', borrados, conservados, raros })
const total = await db.collection('users').where('rol', '==', 'cliente').count().get()
const tango = await db.collection('users').where('aprobadoPor', '==', 'tango').count().get()
console.log('clientes en users:', total.data().count, '| creados por tango:', tango.data().count)
process.exit(0)
