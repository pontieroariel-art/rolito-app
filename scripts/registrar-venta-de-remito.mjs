// Registra en la app la venta que un chofer o supervisor hizo y no cargó en su
// teléfono (2026-09-22, caso Vañek: llevó 20 bidones a Budas Kingdom con el
// remito RC-DT-000096 y no registró la venta → el cierre dio faltante y el
// stock fue a diferencias). Arma el MISMO documento que crearVentaCamion, así
// el circuito sigue solo: remito/factura a Tango desde el depósito del que
// vendió, control de total, liquidación del viaje.
//
//   node scripts/registrar-venta-de-remito.mjs --remito <remitoId> --cliente <uid|codigoTango> \
//     --items agua_destilada_x_6_litros_1781621011862=20 --formaPago cuenta_corriente [--canal contado] \
//     [--fecha 2026-09-22T12:00:00-03:00] [--tangoFactura 119103] [--aplicar]
//
// --tangoFactura N: la oficina YA hizo la factura/remito en Tango a mano. La venta
// nace con tango.estado 'confirmado' y el item de la cola queda pre-confirmado, así
// onVentaCamionCreada no la manda de nuevo (encolarOutbox usa create(): ya existe,
// no pisa). El movimiento de STOCK (egreso del depósito del vendedor) sí se encola.
//
// El precio sale de users.preciosTango.<empresa> del cliente (contado → redonhielo,
// promo → rolito); si falta, se pasa --precio productoId=importe.
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

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const remitoId = opt('remito'), clienteArg = opt('cliente'), itemsArg = opt('items')
const formaPago = opt('formaPago'), canal = opt('canal') ?? 'contado', fechaArg = opt('fecha')
const preciosArg = opt('precio') ?? ''
const tangoFactura = opt('tangoFactura')
const aplicar = argv.includes('--aplicar')
if (!remitoId || !clienteArg || !itemsArg || !['contado_efectivo', 'contado_transferencia', 'cuenta_corriente'].includes(formaPago) || !['contado', 'promo'].includes(canal)) {
  console.error('uso: --remito <id> --cliente <uid|codigoTango> --items prod=cant,... --formaPago contado_efectivo|contado_transferencia|cuenta_corriente [--canal contado|promo] [--fecha ISO] [--precio prod=importe,...] [--aplicar]')
  process.exit(1)
}

const rSnap = await db.doc(`remitosCarga/${remitoId}`).get()
if (!rSnap.exists) throw new Error(`no existe remitosCarga/${remitoId}`)
const r = rSnap.data()
const vendedor = (await db.doc(`users/${r.choferId}`).get()).data()
if (!vendedor) throw new Error(`no existe users/${r.choferId} (el que salió con el remito)`)
const tcfg = (await db.doc('config/tango').get()).data()
const depositoTango = r.depositoTango ?? tcfg.depositos?.[r.choferId]
if (!depositoTango) throw new Error('el vendedor no tiene depósito de Tango: la venta no podría ir a Tango')

let cSnap = await db.doc(`users/${clienteArg}`).get()
if (!cSnap.exists) {
  const q = await db.collection('users').where('rol', '==', 'cliente').where('codigoTango', '==', clienteArg).get()
  if (q.empty) throw new Error(`cliente ${clienteArg} no encontrado (uid ni codigoTango)`)
  cSnap = q.docs[0]
}
const cliente = cSnap.data()
const empresa = canal === 'contado' ? 'redonhielo' : 'rolito'
const catalogo = (await db.doc('config/catalogo').get()).data()
const productos = catalogo?.productos ?? catalogo?.items ?? Object.values(catalogo ?? {})
const preciosManual = Object.fromEntries(preciosArg.split(',').filter(Boolean).map((p) => { const [k, v] = p.split('='); return [k, Number(v)] }))
const items = itemsArg.split(',').map((par) => {
  const [productoId, cant] = par.split('=')
  const cantidad = Number(cant)
  const p = productos.find((x) => x?.id === productoId)
  if (!p) throw new Error(`producto ${productoId} no está en config/catalogo`)
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error(`cantidad inválida para ${productoId}`)
  const precioUnitario = preciosManual[productoId] ?? cliente.preciosTango?.[empresa]?.[productoId]
  if (!(precioUnitario > 0)) throw new Error(`sin precio de ${empresa} para ${productoId} en la ficha del cliente: pasalo con --precio ${productoId}=importe`)
  return { productoId, nombre: p.nombre, cantidad, precioUnitario }
})
const total = items.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0)
const fecha = fechaArg ? admin.firestore.Timestamp.fromDate(new Date(fechaArg)) : admin.firestore.Timestamp.now()
if (Number.isNaN(fecha.toMillis())) throw new Error(`fecha inválida: ${fechaArg}`)

const venta = {
  canal,
  camionId:      r.camionId,
  remitoId,
  remitoCodigo:  r.codigo,
  choferId:      r.choferId,
  choferNombre:  r.choferNombre,
  clienteId:     cSnap.id,
  clienteNombre: cliente.razonSocial || cliente.nombre,
  items,
  total,
  formaPago,
  fecha,
  pedidoId:      null,
  tango:         tangoFactura ? { estado: 'confirmado', facturaNumero: String(tangoFactura) } : { estado: 'pendiente' },
  depositoTango: String(depositoTango),
  depositoTangoNombre: r.depositoTangoNombre ?? vendedor.depositoTangoNombre ?? '',
  ...(cliente.codigoTango ? { clienteCodigoTango: cliente.codigoTango } : {}),
  ...(cliente.idGva14Tango != null ? { clienteIdGva14Tango: cliente.idGva14Tango } : {}),
  // Rastro: la registró la oficina por script, no el teléfono del vendedor.
  registradaPorScript: { script: 'registrar-venta-de-remito.mjs', fecha: new Date().toISOString() },
}
console.log(`Venta de ${r.choferNombre} (depósito ${depositoTango}) a ${venta.clienteNombre} [${cliente.codigoTango ?? 'sin código'}], viaje ${r.codigo}`)
console.log(`  ${canal} · ${formaPago} · fecha ${fecha.toDate().toISOString()}`)
for (const i of items) console.log(`  ${i.nombre}: ${i.cantidad} × $${i.precioUnitario} = $${i.cantidad * i.precioUnitario}`)
console.log(`  TOTAL $${total}`)
if (!aplicar) { console.log('\n(sin --aplicar: no se escribió nada)'); process.exit(0) }
const ref = db.collection('ventasCamion').doc()
if (tangoFactura) {
  // Antes de la venta, para ganarle al trigger: el item de la factura queda
  // confirmado y encolarOutbox (create) no lo pisa.
  await db.doc(`tango-outbox/ventasCamion_${ref.id}`).create({
    entidad: canal === 'promo' || formaPago !== 'cuenta_corriente' ? 'factura' : 'remito',
    empresa, origenColeccion: 'ventasCamion', origenId: ref.id, payload: {},
    estado: 'confirmado', intentos: 0, ultimoError: null,
    resultado: { facturaNumero: String(tangoFactura), via: 'oficina', nota: 'comprobante hecho a mano en Tango; no se reenvía' },
    creadoEn: admin.firestore.FieldValue.serverTimestamp(), actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
  })
}
await ref.set(venta)
console.log(`\nESCRITA ventasCamion/${ref.id}. ${tangoFactura
  ? `Comprobante ya en Tango (${tangoFactura}): no se reenvía; solo se encola el movimiento de stock`
  : `onVentaCamionCreada la manda a Tango como ${formaPago === 'cuenta_corriente' ? 'remito' : 'factura'}`} desde el depósito ${depositoTango}.`)
process.exit(0)
