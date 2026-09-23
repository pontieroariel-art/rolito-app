// Prende "Entrega con remito de fábrica" en los clientes indicados y sella los
// pedidos pendientes que ya tenían cargados (2026-09-23, Coto y Carrefour).
//
// A partir de ahí los pedidos nuevos los sella el server al crearse
// (functions/triggers/orders.ts) y el chofer los entrega sin comprobante de la
// app (utils/entregaFabrica.ts). Los pedidos viejos ya entregados no se tocan.
//
//   node scripts/marcar-remito-fabrica.mjs <uid> [<uid> ...]            (muestra)
//   node scripts/marcar-remito-fabrica.mjs <uid> [<uid> ...] --aplicar
//   node scripts/marcar-remito-fabrica.mjs <uid> --apagar --aplicar     (saca la marca; no toca pedidos)
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('./lib/firebase-admin-compat.cjs')
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))) })
const db = admin.firestore()

const argv = process.argv.slice(2)
const APLICAR = argv.includes('--aplicar')
const APAGAR  = argv.includes('--apagar')
const uids = argv.filter((a) => !a.startsWith('--'))
if (!uids.length) { console.error('uso: <uid> [<uid> ...] [--apagar] [--aplicar]'); process.exit(1) }

for (const uid of uids) {
  const snap = await db.doc(`users/${uid}`).get()
  if (!snap.exists) { console.log(`${uid}: no existe`); continue }
  const u = snap.data()
  if (u.rol !== 'cliente') { console.log(`${uid}: no es cliente (${u.rol})`); continue }
  console.log(`${uid} · ${u.razonSocial ?? u.nombre} · CUIT ${u.cuit ?? '-'} · sucursales ${(u.addresses ?? []).length} · marca actual: ${u.entregaConRemitoDeFabrica === true ? 'SÍ' : 'no'}`)
  if (APAGAR) {
    if (APLICAR) { await snap.ref.update({ entregaConRemitoDeFabrica: false }); console.log('   marca apagada') }
    continue
  }
  // Pedidos que todavía no se entregaron ni cancelaron: se sellan para que el
  // chofer los vea con el camino nuevo (los del día de hoy incluidos).
  const pend = await db.collection('orders').where('clientId', '==', uid).where('status', 'in', ['pendiente', 'confirmado', 'en_camino']).get()
  const sinSello = pend.docs.filter((d) => d.data().entregaSinComprobante !== true)
  console.log(`   pedidos abiertos: ${pend.size} · sin sellar: ${sinSello.length}${sinSello.length ? ' → ' + sinSello.map((d) => `${d.id} (${d.data().status}, ${d.data().date?.toDate?.().toLocaleDateString('es-AR') ?? '?'})`).join(', ') : ''}`)
  if (!APLICAR) continue
  await snap.ref.update({ entregaConRemitoDeFabrica: true })
  const b = db.batch()
  for (const d of sinSello) b.update(d.ref, { entregaSinComprobante: true })
  await b.commit()
  console.log(`   marca prendida · ${sinSello.length} pedido(s) sellado(s)`)
}
console.log(APLICAR ? '\nListo.' : '\n(sin --aplicar: nada escrito)')
process.exit(0)
