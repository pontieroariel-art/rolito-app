/**
 * encolar-anulacion-remito.mjs — poner a mano en la cola la anulación de un remito (2026-09-20)
 *
 * Para estrenar el writer `anulacionRemito` sin esperar a que un chofer anule:
 * toma un remito que la app ya dio por anulado y que Tango todavía tiene vivo,
 * y crea el item de `tango-outbox` que el bridge va a ejecutar.
 *
 * Con esto se puede hacer el dry-run (que ejecuta todo en Tango y REVIERTE, sin
 * tocar Firestore) y después, si la salida coincide con la receta, correrlo de
 * verdad — anulando uno de los remitos que la oficina debe igual.
 *
 * Uso:
 *   node scripts/tango/encolar-anulacion-remito.mjs --remito R0110500000934
 *   node scripts/tango/encolar-anulacion-remito.mjs --remito R0110500000934 --aplicar
 *   node scripts/tango/encolar-anulacion-remito.mjs --borrar R0110500000934   # saca el item de la cola
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../lib/firebase-admin-compat.cjs')
const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

const arg = (nombre) => {
  const a = process.argv.find((x) => x.startsWith(`--${nombre}=`))
  if (a) return a.slice(nombre.length + 3)
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : null
}
const APLICAR = process.argv.includes('--aplicar')
const BORRAR  = arg('borrar')
const REMITO  = arg('remito') ?? BORRAR

if (!REMITO) {
  console.error('Falta --remito R0110500000934 (o --borrar <remito>)')
  process.exit(1)
}

// La venta es la que tiene ese número de remito en Tango.
const snap = await db.collection('ventasCamion').where('tango.remitoNumero', '==', REMITO).limit(2).get()
if (snap.empty) { console.error(`No hay ninguna venta con tango.remitoNumero = ${REMITO}`); process.exit(1) }
if (snap.size > 1) { console.error(`Hay ${snap.size} ventas con ese número: revisalo a mano`); process.exit(1) }

const venta   = snap.docs[0]
const datos   = venta.data()
const a       = datos.anulacion ?? {}
const outboxId = `anulacionRemito_${venta.id}`

console.log(`\nRemito ${REMITO}`)
console.log(`  venta ${venta.id} · ${datos.clienteNombre ?? ''} · ${datos.choferNombre ?? ''}`)
console.log(`  anulación en la app: ${a.estado ?? '(ninguna)'} · tipo ${a.tipo ?? '-'} · tango ${a.tango?.estado ?? '-'}`)

if (BORRAR) {
  if (!APLICAR) { console.log(`\n  borraría tango-outbox/${outboxId}. Agregá --aplicar.\n`); process.exit(0) }
  await db.doc(`tango-outbox/${outboxId}`).delete()
  console.log(`\n  borrado tango-outbox/${outboxId}\n`)
  process.exit(0)
}

// No encolar lo que no corresponde: la app tiene que haberlo dado por anulado.
if (a.estado !== 'anulada' || a.tipo !== 'remito') {
  console.error(`\n  Esa venta no tiene un remito anulado en la app (estado ${a.estado}, tipo ${a.tipo}). No se encola.\n`)
  process.exit(1)
}

const ya = await db.doc(`tango-outbox/${outboxId}`).get()
if (ya.exists) {
  const d = ya.data()
  console.log(`\n  Ya está en la cola: estado ${d.estado}, intentos ${d.intentos ?? 0}${d.ultimoError ? `, último error: ${d.ultimoError}` : ''}`)
  console.log(`  Para el dry-run:  node bridge-sql.mjs --dry-run --solo=${outboxId}\n`)
  process.exit(0)
}

if (!APLICAR) {
  console.log(`\n  crearía tango-outbox/${outboxId} con payload { remitoNumero: '${REMITO}' }`)
  console.log('  Volvé a correrlo con --aplicar.\n')
  process.exit(0)
}

await db.doc(`tango-outbox/${outboxId}`).create({
  entidad:         'anulacionRemito',
  origenColeccion: 'ventasCamion',
  origenId:        venta.id,
  empresa:         'redonhielo',
  payload:         { remitoNumero: REMITO },
  estado:          'pendiente',
  intentos:        0,
  ultimoError:     null,
  creadoEn:        admin.firestore.FieldValue.serverTimestamp(),
  actualizadoEn:   admin.firestore.FieldValue.serverTimestamp(),
})

console.log(`\n  OK · tango-outbox/${outboxId}`)
console.log('\n  En la VM, dentro de C:\\RolitoSync\\sql:')
console.log(`    node bridge-sql.mjs --dry-run --solo=${outboxId}     (ejecuta y REVIERTE; no toca nada)`)
console.log(`    node bridge-sql.mjs --once   --solo=${outboxId}      (lo hace de verdad)\n`)
process.exit(0)
