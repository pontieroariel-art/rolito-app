/**
 * diagnosticar-anulados-tango.mjs — ¿por qué siguen ahí? (2026-09-20)
 *
 * Los bloques "Remitos / Recibos anulados en la app que hay que anular en
 * Tango" de Comprobantes de clientes listan lo que tiene
 * `anulacion.tango.estado == 'pendiente_oficina'`, y la fila se va sola cuando
 * el lector de comprobantes ve el comprobante anulado en Tango (remito con
 * ESTADO_MOV 'A', recibo con ESTADO 'ANU' en `tangoComprobantes/{empresa}_{codigo}`).
 *
 * Si la oficina YA los anuló y las filas siguen, la comparación no está
 * cerrando. Este script la hace fila por fila y dice exactamente dónde se
 * rompe: sin código de cliente, sin número de Tango, índice inexistente, el
 * número no está en el índice, o está con otro estado.
 *
 * SOLO LEE. No escribe nada.
 *
 *   node scripts/diagnosticar-anulados-tango.mjs
 */

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

const txt = (v) => String(v ?? '').trim()
const fecha = (ts) => (ts?.toDate ? ts.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

// Muestra claves parecidas del índice: si el número está pero escrito distinto
// (con o sin prefijo, con ceros de más), acá se ve de una.
function parecidas(claves, numero) {
  const limpio = numero.replace(/^[A-Z]/, '').replace(/^0+/, '')
  return claves.filter((k) => k.includes(limpio) || limpio.includes(k.replace(/^[A-Z]/, '').replace(/^0+/, ''))).slice(0, 5)
}

async function remitos() {
  const snap = await db.collection('ventasCamion')
    .where('anulacion.tipo', '==', 'remito')
    .where('anulacion.tango.estado', '==', 'pendiente_oficina')
    .limit(200).get()
  console.log(`\n══ REMITOS pendientes: ${snap.size}\n`)
  for (const d of snap.docs) {
    const v = d.data()
    const codigo = txt(v.clienteCodigoTango)
    const numero = txt(v.tango?.remitoNumero)
    const quien  = `${txt(v.clienteNombre) || txt(v.clienteRazonSocial) || '(sin nombre)'} · anulado ${fecha(v.anulacion?.anuladaEn)}`
    if (!codigo) { console.log(`  ✗ ${numero || d.id}  ${quien}\n      SIN clienteCodigoTango → la reconciliación lo saltea SIEMPRE`); continue }
    if (!numero) { console.log(`  ✗ ${d.id}  ${quien}\n      SIN tango.remitoNumero (el remito nunca llegó a Tango) → se saltea SIEMPRE`); continue }

    const clave = `redonhielo_${codigo}`
    const idx = await db.doc(`tangoComprobantes/${clave}`).get()
    if (!idx.exists) { console.log(`  ✗ ${numero}  ${quien}\n      NO existe ${clave} — el lector nunca escribió el índice de ese cliente`); continue }
    const rem = idx.data()?.remitos ?? {}
    const fila = rem[numero]
    if (!fila) {
      const cerca = parecidas(Object.keys(rem), numero)
      console.log(`  ✗ ${numero}  ${quien}\n      el índice tiene ${Object.keys(rem).length} remitos pero NO "${numero}"${cerca.length ? `\n      parecidos: ${cerca.join(', ')}` : ''}`)
      continue
    }
    if (fila.estado === 'A') console.log(`  ✓ ${numero}  ${quien}\n      Tango dice ANULADO — se confirma en la próxima pasada`)
    else console.log(`  ·  ${numero}  ${quien}\n      Tango lo tiene con estado "${fila.estado}" (${fila.fecha ?? 's/f'}) → TODAVÍA NO está anulado allá`)
  }
}

async function recibos() {
  const snap = await db.collection('cobranzas')
    .where('anulacion.tango.estado', '==', 'pendiente_oficina')
    .limit(200).get()
  console.log(`\n══ RECIBOS pendientes: ${snap.size}\n`)
  for (const d of snap.docs) {
    const c = d.data()
    const codigo  = txt(c.codigoTango)
    const empresa = txt(c.empresa) || 'redonhielo'
    const recibo  = txt(c.tango?.reciboNumero)
    const quien   = `${txt(c.clienteNombre)} · ${txt(c.numeroRecibo)} · anulado ${fecha(c.anulacion?.anuladaEn)}`
    if (!codigo) { console.log(`  ✗ ${recibo || d.id}  ${quien}\n      SIN codigoTango → se saltea SIEMPRE`); continue }
    if (!recibo) { console.log(`  ✗ ${d.id}  ${quien}\n      SIN tango.reciboNumero → se saltea SIEMPRE`); continue }

    const clave = `${empresa}_${codigo}`
    const idx = await db.doc(`tangoComprobantes/${clave}`).get()
    if (!idx.exists) { console.log(`  ✗ ${recibo}  ${quien}\n      NO existe ${clave}`); continue }
    const facturas = idx.data()?.facturas ?? {}
    // La reconciliación busca la clave REC_<numero> en mayúsculas.
    const buscada = `REC_${recibo.toUpperCase()}`
    const fila = facturas[buscada]
    if (!fila) {
      const cerca = Object.keys(facturas).filter((k) => k.startsWith('REC_')).slice(0, 8)
      console.log(`  ✗ ${recibo}  ${quien}\n      el índice NO tiene "${buscada}" (${Object.keys(facturas).length} comprobantes)\n      recibos que sí tiene: ${cerca.join(', ') || '(ninguno)'}`)
      // ¿Dónde está ese recibo entonces? El lector escribe un doc POR
      // comprobante (`tangoComprobanteDetalle/{empresa}_{tipo}_{numero}`), que
      // trae el código de cliente con el que Tango lo registró: si el recibo
      // existe pero bajo OTRO código (una sucursal) o en la otra empresa, el
      // índice del cliente nunca lo va a tener y la fila no se va nunca.
      console.log(`      cobranza: empresa=${empresa} codigoTango=${codigo} clienteId=${txt(c.clienteId)} idRecibo=${txt(c.tango?.idReciboTango)}`)
      for (const emp of ['redonhielo', 'rolito']) {
        for (const tipo of ['REC', 'RC']) {
          const det = await db.doc(`tangoComprobanteDetalle/${emp}_${tipo}_${recibo.toUpperCase()}`).get()
          if (det.exists) {
            const d2 = det.data()
            console.log(`      ENCONTRADO en ${emp}_${tipo}_${recibo}: código de cliente "${txt(d2.codigo)}", estado "${txt(d2.estado)}", fecha ${txt(d2.fecha)}`)
          }
        }
      }
      continue
    }
    const estado = txt(fila.estado).toUpperCase()
    if (estado === 'ANU') console.log(`  ✓ ${recibo}  ${quien}\n      Tango dice ANU — se confirma en la próxima pasada`)
    else console.log(`  ·  ${recibo}  ${quien}\n      Tango lo tiene con estado "${estado || '(vacío)'}" → TODAVÍA NO está anulado allá`)
  }
}

await remitos()
await recibos()
console.log('\nReferencias: ✓ ya está anulado en Tango y la app lo va a soltar · "·" Tango todavía lo muestra vivo · ✗ la comparación no puede cerrar nunca\n')
process.exit(0)
