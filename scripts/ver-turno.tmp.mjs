import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin = require('./lib/firebase-admin-compat.cjs')
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))) })
const db = admin.firestore()
const s = await db.collection('cajaSesiones').where('estado', '==', 'abierta').get()
for (const d of s.docs) {
  const x = d.data()
  console.log(d.id, x.cajero?.nombre, x.fecha, x.plantaId, x.abiertaEn?.toDate?.().toISOString(), 'fondo', x.fondoInicial)
  const uid = x.cajero.uid
  const desde = new Date(`${x.fecha}T03:00:00Z`), hasta = new Date(desde.getTime() + 86400000)
  for (const col of ['ventasVentanilla', 'cobranzas']) {
    const q = await db.collection(col).where(col === 'cobranzas' ? 'cobradorId' : 'vendedorId', '==', uid).where('fecha', '>=', desde).where('fecha', '<', hasta).get().catch(e => ({ size: 'ERR ' + e.message.slice(0, 80) }))
    console.log('  ', col, q.size)
  }
  for (const col of ['anticiposCaja','valesCaja']) {}
  const r = await db.collection('rendiciones').where('cajaSesionId', '==', d.id).get(); console.log('   sobres de esa sesión', r.size)
  const v = await db.collection('valesCaja').where('cajaSesionId', '==', d.id).get(); console.log('   vales', v.size)
  const otras = await db.collection('cajaSesiones').where('cajero.uid', '==', uid).get()
  console.log('   sesiones de ese cajero:', otras.docs.map(o => o.id.split('_')[0] + '#' + o.data().numero + ':' + o.data().estado).join(', '))
}
process.exit(0)
