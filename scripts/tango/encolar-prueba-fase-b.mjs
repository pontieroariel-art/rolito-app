/**
 * encolar-prueba-fase-b.mjs — Items de PRUEBA EN SECO para los sentidos `diferencia`
 * (camión → 98) y `cambioVentanilla` (planta → 99) de la fase B (INTEGRACION.md §36).
 *
 * Nacen con `estado: 'error'` y `ultimoError: 'PRUEBA EN SECO…'`: el barrido normal del bridge
 * solo toma pendiente/enviado, así que NUNCA se mandan a Tango; solo los ve
 * `node bridge-sql.mjs --dry-run --once --solo=<id>` (que con --solo también toma los 'error'
 * y en dry-run revierte la transacción sin tocar el doc). Corre contra PRODUCCIÓN.
 *
 *   node scripts/tango/encolar-prueba-fase-b.mjs --diferencia <liquidacionId>
 *        → liquidaciones_<id>_diferencia con los faltantes reales de ese cierre (faltantesParaTango)
 *   node scripts/tango/encolar-prueba-fase-b.mjs --cambio-ventanilla <ventaId> [productoId=bolsa_3kg] [cantidad=1]
 *        → ventasVentanilla_<id>_cambio con UN cambio inventado sobre una venta real (la venta no se toca)
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')
const { faltantesParaTango, rotasPorProductoDe } = require('../../functions/lib/services/diferenciasReparto.js')
const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
const FV = admin.firestore.FieldValue

const args = process.argv.slice(2)
const valorDe = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const kv = (k, def) => { const a = args.find((x) => x.startsWith(`${k}=`)); return a ? a.slice(k.length + 1) : def }
const PRUEBA = 'PRUEBA EN SECO (fase B): no enviar. Solo para bridge-sql.mjs --dry-run --solo'

async function crear(outboxId, item, resumen) {
  try {
    await db.collection('tango-outbox').doc(outboxId).create({
      ...item,
      estado: 'error', intentos: 0, ultimoError: PRUEBA,
      notaManual: PRUEBA,
      creadoEn: FV.serverTimestamp(), actualizadoEn: FV.serverTimestamp(),
    })
    console.log('creado', outboxId, '→', resumen)
    console.log(`  dry-run en la VM:  node bridge-sql.mjs --dry-run --once --solo=${outboxId}`)
  } catch (e) {
    console.log(outboxId, e.code === 6 ? 'ya existía' : `ERROR ${e.message}`)
  }
}

const liqId = valorDe('--diferencia')
if (liqId) {
  const snap = await db.doc(`liquidaciones/${liqId}`).get()
  if (!snap.exists) { console.log(liqId, 'NO existe'); process.exit(1) }
  const liq = snap.data()
  const descargasIds = Array.isArray(liq.descargasIds) ? liq.descargasIds.filter(Boolean) : []
  const productos = Array.isArray(liq.productos) ? liq.productos : []
  let rotas = {}
  if (productos.some((p) => typeof p?.rotas !== 'number')) {
    const docs = await Promise.all(descargasIds.slice(0, 20).map((id) => db.doc(`descargasCamion/${id}`).get()))
    rotas = rotasPorProductoDe(docs.map((d) => d.data() ?? {}))
  }
  const items = faltantesParaTango(productos, rotas)
  if (!items.length) { console.log(liqId, 'sin faltantes: nada que probar'); process.exit(0) }
  await crear(`liquidaciones_${liqId}_diferencia`, {
    entidad: 'transferenciaDeposito', empresa: 'redonhielo',
    origenColeccion: 'liquidaciones', origenId: liqId,
    payload: {
      sentido:       'diferencia',
      codigo:        liq.codigo ?? null,
      plantaId:      liq.plantaId,
      depositoTango: liq.depositoTango ?? null,
      choferId:      liq.choferId,
      choferNombre:  liq.choferNombre,
      items,
      fecha:         typeof liq.fecha === 'string' ? `${liq.fecha}T12:00:00` : liq.createdAt,
      cerradaPor:    liq.cerradaPor ?? null,
    },
  }, `${liq.codigo} ${liq.choferNombre}: ${items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', ')}`)
}

const ventaId = valorDe('--cambio-ventanilla')
if (ventaId) {
  const snap = await db.doc(`ventasVentanilla/${ventaId}`).get()
  if (!snap.exists) { console.log(ventaId, 'NO existe'); process.exit(1) }
  const venta = snap.data()
  const productoId = kv('productoId', 'bolsa_3kg')
  const cantidad = Number(kv('cantidad', '1'))
  const cat = await db.doc(`catalogo/${productoId}`).get()
  const nombre = cat.data()?.nombre ?? productoId
  const interno = venta.comprobanteInterno
  await crear(`ventasVentanilla_${ventaId}_cambio`, {
    entidad: 'transferenciaDeposito', empresa: 'redonhielo',
    origenColeccion: 'ventasVentanilla', origenId: ventaId,
    payload: {
      sentido:            'cambioVentanilla',
      codigo:             interno?.numero ? `${interno.tipo ?? ''} ${interno.puntoVenta ?? ''}-${interno.numero}`.trim() : null,
      plantaId:           venta.plantaId ?? null,
      clienteCodigoTango: venta.clienteCodigoTango ?? null,
      clienteNombre:      venta.clienteNombre ?? null,
      items:              [{ productoId, nombre, cantidad }],
      fecha:              venta.fecha,
      cajaNombre:         venta.cajaNombre ?? null,
    },
  }, `venta de ${venta.clienteNombre} (${venta.plantaId}): cambio inventado ${cantidad} × ${nombre}`)
}

if (!liqId && !ventaId) console.log('Uso: --diferencia <liquidacionId> | --cambio-ventanilla <ventaId> [productoId=…] [cantidad=…]')
process.exit(0)
