/**
 * emular-arca.mjs — las Cloud Functions que la ventanilla y el camión esperan,
 * de mentira, contra el emulador.
 *
 * En producción, al crearse una venta de contado (efectivo o transferencia,
 * canal contado = Redonhielo) el trigger `onVentaContadoFacturar` /
 * `onVentaVentanillaContadoFacturar` le pide el CAE a ARCA y escribe
 * `venta.factura`; caja no imprime nada hasta que llega, y el "a rendir"
 * cuenta el total de la factura (neto + IVA), no el precio de lista.
 *
 * En el emulador no corre ninguna function, así que este script mira las dos
 * colecciones y, a los ~3 segundos de cada venta de contado sin factura, le
 * escribe una factura "emitida" con IVA 21 % y CAE inventado (A si el cliente
 * es responsable inscripto, B si no). Además marca `tango.estado = confirmado`
 * en ventas y cobranzas nuevas, para que las pantallas se vean como en prod.
 *
 * Uso (con `npm run emulators` levantado, en otra terminal, y dejarlo abierto):
 *   npm run emular:arca
 */

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'

import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

initializeApp({ projectId: 'rolito-app' })
const db = getFirestore()

const DEMORA_MS  = 3000
const PUNTO_VENTA = 1104
const CONTADOR = db.collection('config').doc('emuladorArca')

const pad2 = (n) => String(n).padStart(2, '0')
const AAAAMMDD = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

const esContadoAFacturar = (v) =>
  v.canal === 'contado' && (v.formaPago === 'contado_efectivo' || v.formaPago === 'contado_transferencia') && !v.factura

async function letraPara(v) {
  if (!v.clienteId) return 'B'
  const s = await db.collection('users').doc(v.clienteId).get()
  return s.exists && s.data().categoriaIvaTango === 'RI' ? 'A' : 'B'
}

async function proximoNumero() {
  return db.runTransaction(async (tx) => {
    const s = await tx.get(CONTADOR)
    const next = s.exists ? s.data().next : 600
    tx.set(CONTADOR, { next: next + 1 })
    return next
  })
}

const enCurso = new Set()

async function facturar(coleccion, snap) {
  const v = snap.data()
  const clave = `${coleccion}/${snap.id}`
  if (enCurso.has(clave) || !esContadoAFacturar(v)) return
  enCurso.add(clave)
  try {
    await dormir(DEMORA_MS)
    // Releer: puede haberse facturado o anulado en el medio.
    const fresco = await snap.ref.get()
    if (!fresco.exists || !esContadoAFacturar(fresco.data())) return
    const letra  = await letraPara(v)
    const numero = await proximoNumero()
    const neto   = Number(v.total) || 0
    const iva    = Math.round(neto * 0.21 * 100) / 100
    const hoy    = new Date(); const vto = new Date(hoy); vto.setDate(vto.getDate() + 10)
    const factura = {
      estado: 'emitida', numero, puntoVenta: PUNTO_VENTA, cbteTipo: letra === 'A' ? 1 : 6,
      cae: `7${String(numero).padStart(13, '0')}`, caeFchVto: AAAAMMDD(vto),
      importes: { fecha: AAAAMMDD(hoy), neto, iva, tributos: 0, total: Math.round((neto + iva) * 100) / 100 },
    }
    await snap.ref.set({ factura, tango: { estado: 'confirmado', facturaNumero: `${letra}${String(PUNTO_VENTA).padStart(5, '0')}${String(numero).padStart(8, '0')}` } }, { merge: true })
    console.log(`🧾 ${coleccion}/${snap.id}: factura ${letra} ${pad2(PUNTO_VENTA)}-${String(numero).padStart(8, '0')} · neto $${neto.toLocaleString('es-AR')} + IVA → $${factura.importes.total.toLocaleString('es-AR')}`)
  } catch (err) {
    console.error(`✗ ${clave}:`, err.message)
  } finally {
    enCurso.delete(clave)
  }
}

async function confirmarTango(coleccion, snap) {
  const d = snap.data()
  if (!d.tango || d.tango.estado !== 'pendiente') return
  // La factura de contado la confirma `facturar` con su número; el resto (remitos, promo, recibos) acá.
  if (coleccion !== 'cobranzas' && esContadoAFacturar(d)) return
  await dormir(DEMORA_MS)
  const fresco = await snap.ref.get()
  if (!fresco.exists || fresco.data().tango?.estado !== 'pendiente') return
  const numero = `${coleccion === 'cobranzas' ? 'X' : 'R'}0001${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  await snap.ref.set({ tango: { estado: 'confirmado', ...(coleccion === 'cobranzas' ? { reciboNumero: numero } : { remitoNumero: numero }) } }, { merge: true })
  console.log(`✅ ${coleccion}/${snap.id}: Tango confirmado (${numero})`)
}

function mirar(coleccion) {
  const arranque = Date.now()
  db.collection(coleccion).onSnapshot((qs) => {
    for (const ch of qs.docChanges()) {
      if (ch.type === 'removed') continue
      const d = ch.doc.data()
      // Solo lo que se crea desde ahora: lo del seed ya viene facturado/confirmado.
      const fecha = d.fecha?.toMillis?.() ?? 0
      if (fecha < arranque - 60_000) continue
      if (coleccion !== 'cobranzas') void facturar(coleccion, ch.doc)
      void confirmarTango(coleccion, ch.doc)
    }
  }, (err) => console.error(`✗ stream ${coleccion}:`, err.message))
}

console.log('ARCA y Tango de mentira contra el emulador (Ctrl+C para salir).')
console.log('Toda venta de contado que hagas en la app recibe su factura con IVA a los 3 segundos; remitos, promo y recibos quedan "confirmados" en Tango.\n')
mirar('ventasVentanilla')
mirar('ventasCamion')
mirar('cobranzas')
// Mantener vivo el proceso.
setInterval(() => { void FieldValue }, 60_000)
