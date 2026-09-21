// Anula en la app un remito de cuenta corriente hecho en VENTANILLA (2026-09-21).
//
// La app todavía no tiene botón para esto (la anulación de ventanilla cubre
// solo facturas con nota de crédito; el remito de cta. cte. quedó para la
// etapa 2). Escribe en la venta el mismo `anulacion` que deja facturación al
// anular un remito del camión: la venta deja de contar en Mi día, el cierre
// de caja y los tableros, y el trigger `onVentaVentanillaAnulada` la anota en
// el cierre de caja si el turno ya estaba cerrado. A diferencia del remito del
// camión, acá NO hay push a facturación: en Tango lo anula la oficina a mano
// (y si ya se facturó, primero la nota de crédito). `anulacion.tango` queda en
// pendiente_oficina para que la app lo muestre como "la oficina lo anula en Tango".
//
//   node scripts/anular-remito-ventanilla.mjs <ventaId> [<ventaId>…] --motivo "texto" [--actor <uid>] [--aplicar]
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

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const APLICAR = args.includes('--aplicar')
const MOTIVO = opt('--motivo') ?? 'prueba'
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--motivo' && args[i - 1] !== '--actor')
if (!ids.length) { console.error('falta el id de la venta'); process.exit(1) }

let actorUid = opt('--actor')
if (!actorUid) {
  const sa = await db.collection('users').where('rol', '==', 'super_admin').get()
  actorUid = sa.docs.find((d) => /rolito|ariel/i.test(String(d.data().nombre ?? '')))?.id
}
const actorDoc = await db.doc(`users/${actorUid}`).get()
const actor = { uid: actorUid, nombre: String(actorDoc.data()?.nombre ?? 'Administración') }
console.log(`${APLICAR ? 'APLICANDO' : 'EN SECO'} · anula ${actor.nombre} · motivo "${MOTIVO}"\n`)

for (const id of ids) {
  const ref = db.doc(`ventasVentanilla/${id}`)
  const snap = await ref.get()
  if (!snap.exists) { console.log(id, '→ no existe en ventasVentanilla'); continue }
  const v = snap.data()
  const fechaVenta = v.fecha.toDate().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const problemas = []
  if (v.canal !== 'contado' || v.formaPago !== 'cuenta_corriente') problemas.push(`no es cta. cte. (${v.canal} / ${v.formaPago})`)
  if (v.comprobanteInterno?.tipo !== 'remito') problemas.push('no tiene remito interno')
  if (v.factura?.estado === 'emitida') problemas.push('tiene factura ARCA: va por nota de crédito, no por acá')
  if (v.anulacion) problemas.push(`ya tiene anulación (${v.anulacion.estado})`)
  console.log(`${id} · ${fechaVenta} · ${v.clienteNombre} · remito ${String(v.comprobanteInterno?.puntoVenta).padStart(5, '0')}-${String(v.comprobanteInterno?.numero).padStart(8, '0')} · Tango ${v.tango?.remitoNumero ?? '-'} · $${v.importes?.total ?? v.total} · cajero ${v.cajaNombre ?? '-'}`)
  if (problemas.length) { console.log('   NO se anula:', problemas.join('; ')); continue }
  if (!APLICAR) { console.log('   se anularía'); continue }
  await ref.update({
    anulacion: {
      estado: 'anulada', solicitudId: '', tipo: 'remito', motivo: 'otro', nota: MOTIVO,
      anuladaPor: actor, anuladaEn: admin.firestore.Timestamp.now(), fechaVenta, origen: 'facturacion',
      tango: { estado: 'pendiente_oficina' },
    },
  })
  console.log('   ✔ anulada en la app · en Tango lo anula la oficina:', v.tango?.remitoNumero ?? '(sin número)')
}
if (!APLICAR) console.log('\nFue en seco. Con --aplicar escribe.')
process.exit(0)
