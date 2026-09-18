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

const dias = Number(process.argv[2] ?? 14)
const desde = new Date(); desde.setDate(desde.getDate() - dias); desde.setHours(0, 0, 0, 0)
const ts = admin.firestore.Timestamp.fromDate(desde)
const dia = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

console.log(`\n=== Uso de la app por los choferes — últimos ${dias} días (desde ${dia(desde)}) ===\n`)

const [ventas, cobranzas, pedidos, remitos] = await Promise.all([
  db.collection('ventasCamion').where('fecha', '>=', ts).get(),
  db.collection('cobranzas').where('fecha', '>=', ts).get(),
  db.collection('orders').where('date', '>=', dia(desde)).get(),
  db.collection('remitosCarga').where('fecha', '>=', ts).get(),
])

console.log(`ventasCamion: ${ventas.size} · cobranzas: ${cobranzas.size} · pedidos: ${pedidos.size} · remitos de carga: ${remitos.size}\n`)

// ── Cuánto se usa cada cosa de la pantalla ──
const porChofer = new Map()
const fila = (id, nombre) => {
  let f = porChofer.get(id)
  if (!f) { f = { nombre, ventas: 0, cobranzas: 0, entregasPedido: 0, anuladas: 0, dias: new Set() }; porChofer.set(id, f) }
  return f
}
ventas.forEach((d) => {
  const v = d.data()
  const f = fila(v.choferId, v.choferNombre ?? '?')
  f.ventas += 1
  f.dias.add(dia(v.fecha.toDate()))
  if (v.pedidoId) f.entregasPedido += 1
  if (v.anulacion?.estado === 'anulada') f.anuladas += 1
})
cobranzas.forEach((d) => {
  const c = d.data()
  const f = fila(c.registradoPor?.uid ?? '?', c.registradoPor?.nombre ?? '?')
  f.cobranzas += 1
})

console.log('Por repartidor (ventas / cobranzas / entregas de pedido / anuladas / días activos):')
;[...porChofer.entries()]
  .sort((a, b) => b[1].ventas - a[1].ventas)
  .slice(0, 15)
  .forEach(([, f]) => console.log(`  ${f.nombre.padEnd(28)} ${String(f.ventas).padStart(4)} ${String(f.cobranzas).padStart(5)} ${String(f.entregasPedido).padStart(5)} ${String(f.anuladas).padStart(4)}   ${f.dias.size} días`))

// ── Pedidos de logística: ¿se entregan desde la app? ──
const conteoEstados = {}
let conDriver = 0
pedidos.forEach((d) => {
  const p = d.data()
  conteoEstados[p.status] = (conteoEstados[p.status] ?? 0) + 1
  if (p.driverId) conDriver += 1
})
console.log(`\nPedidos: ${JSON.stringify(conteoEstados)} · con chofer asignado: ${conDriver}/${pedidos.size}`)

// ── Ventas por canal y forma de pago (qué hace realmente el chofer) ──
const canal = {}, pago = {}, conCliente = { registrado: 0, ocasional: 0 }
ventas.forEach((d) => {
  const v = d.data()
  canal[v.canal ?? '?'] = (canal[v.canal ?? '?'] ?? 0) + 1
  pago[v.formaPago ?? '?'] = (pago[v.formaPago ?? '?'] ?? 0) + 1
  if (v.clienteId && v.clienteId !== 'externo') conCliente.registrado += 1; else conCliente.ocasional += 1
})
console.log(`\nVentas por canal: ${JSON.stringify(canal)}`)
console.log(`Ventas por forma de pago: ${JSON.stringify(pago)}`)
console.log(`Cliente registrado vs ocasional: ${JSON.stringify(conCliente)}`)

// ── Cambios y GPS ──
let conCambios = 0
ventas.forEach((d) => { if ((d.data().cambios ?? []).length > 0) conCambios += 1 })
const ubic = await db.collection('ubicaciones').get()
const frescas = ubic.docs.filter((d) => {
  const u = d.data()
  const t = u.updatedAt?.toDate?.() ?? u.timestamp?.toDate?.()
  return t && (Date.now() - t.getTime()) < 7 * 24 * 60 * 60 * 1000
})
console.log(`\nVentas con cambio de bolsas rotas: ${conCambios}`)
console.log(`Docs de GPS: ${ubic.size} (con posición de los últimos 7 días: ${frescas.length})`)

// ── Ventas por hora del día: cuándo se usa el teléfono ──
const porHora = new Array(24).fill(0)
ventas.forEach((d) => { porHora[d.data().fecha.toDate().getHours()] += 1 })
console.log('\nVentas por hora del día:')
porHora.forEach((n, h) => { if (n > 0) console.log(`  ${String(h).padStart(2, '0')}h ${'█'.repeat(Math.ceil(n / 3))} ${n}`) })

process.exit(0)
