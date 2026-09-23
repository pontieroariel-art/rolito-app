/**
 * diagnosticar-cliente-000000.mjs — comprobantes que Tango registró sin cliente (2026-09-20)
 *
 * El recibo X0110800000169 de FERRANTE (cobranza con codigoTango FC.583,
 * empresa rolito) figura en Tango con el código de cliente `000000`. Mientras
 * estuvo vigente, ese recibo NO estaba imputado a la cuenta corriente de
 * FERRANTE. Si le pasó a uno puede haberle pasado a más, y eso no se ve desde
 * la app: la ficha del cliente lee por código, así que un comprobante con otro
 * código es invisible ahí.
 *
 * Este script busca en el espejo de comprobantes de Tango
 * (`tangoComprobanteDetalle`, que el lector escribe uno por comprobante) todos
 * los que quedaron con código `000000` o vacío, y muestra qué son, de cuándo y
 * a nombre de quién los emitió Tango.
 *
 * SOLO LEE. No escribe nada.
 *
 *   node scripts/diagnosticar-cliente-000000.mjs
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('./lib/firebase-admin-compat.cjs')
const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

const txt = (v) => String(v ?? '').trim()

// 1. El caso conocido, entero: para ver a nombre de quién quedó en Tango.
console.log('\n══ El recibo de FERRANTE, como lo tiene Tango\n')
const caso = await db.doc('tangoComprobanteDetalle/rolito_REC_X0110800000169').get()
if (!caso.exists) console.log('  no está el detalle (lo habrá podado el lector)')
else {
  const d = caso.data()
  console.log(`  ${txt(d.tipo)} ${txt(d.numero)} · empresa ${txt(d.empresa)} · fecha ${txt(d.fecha)} · estado ${txt(d.estado)}`)
  console.log(`  código de cliente en Tango: "${txt(d.codigo)}"`)
  console.log(`  cliente que imprime el comprobante: ${JSON.stringify(d.cliente ?? {})}`)
  console.log(`  usuario que lo hizo: "${txt(d.usuario)}"`)
  if (Array.isArray(d.renglones)) console.log(`  renglones: ${d.renglones.length}`)
}

// 2. ¿A cuántos más les pasó? El campo `codigo` es de un solo valor, así que
// la consulta no necesita índice compuesto.
for (const codigo of ['000000', '']) {
  const snap = await db.collection('tangoComprobanteDetalle').where('codigo', '==', codigo).limit(300).get()
  console.log(`\n══ Comprobantes con código de cliente "${codigo || '(vacío)'}": ${snap.size}\n`)
  const porTipo = {}
  for (const d of snap.docs) {
    const x = d.data()
    const k = `${txt(x.empresa)} ${txt(x.tipo)}`
    porTipo[k] = (porTipo[k] ?? 0) + 1
  }
  for (const [k, n] of Object.entries(porTipo).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${n}`)
  // Los recibos son los que importan: son plata imputada a una cuenta.
  const recibos = snap.docs.map((d) => d.data()).filter((x) => txt(x.tipo) === 'REC')
    .sort((a, b) => txt(b.fecha).localeCompare(txt(a.fecha)))
  if (recibos.length) {
    console.log(`\n  RECIBOS (los que mueven cuenta corriente), ${recibos.length}:`)
    for (const r of recibos.slice(0, 40)) {
      console.log(`    ${txt(r.numero).padEnd(16)} ${txt(r.fecha)}  estado ${txt(r.estado).padEnd(4)} ${txt(r.cliente?.razonSocial) || '(sin razón social)'}  usuario ${txt(r.usuario)}`)
    }
    if (recibos.length > 40) console.log(`    … y ${recibos.length - 40} más`)
  }
}

// 3. ¿Existe el índice de ese "cliente"? Si existe, dice cuánto se acumuló ahí.
for (const clave of ['rolito_000000', 'redonhielo_000000']) {
  const idx = await db.doc(`tangoComprobantes/${clave}`).get()
  if (!idx.exists) { console.log(`\n  ${clave}: no existe`); continue }
  const d = idx.data()
  console.log(`\n  ${clave}: ${Object.keys(d.facturas ?? {}).length} comprobantes de venta, ${Object.keys(d.remitos ?? {}).length} remitos`)
}

// 4. La pregunta que decide todo: ¿Tango le borra el cliente a TODO recibo que
// anula? Si es así, ningún recibo anulado podía confirmarse mirando la ficha
// del cliente —no era el caso raro de FERRANTE, era la regla— y la
// reconciliación de recibos nunca iba a cerrar por esa vía.
console.log('\n══ Los recibos que cayeron en el cajón "sin cliente"\n')
for (const clave of ['rolito_000000', 'redonhielo_000000']) {
  const idx = await db.doc(`tangoComprobantes/${clave}`).get()
  if (!idx.exists) continue
  const facturas = idx.data()?.facturas ?? {}
  const recibos = Object.entries(facturas).filter(([k]) => k.startsWith('REC_'))
  const anulados = recibos.filter(([, v]) => txt(v?.estado).toUpperCase() === 'ANU')
  console.log(`  ${clave}: ${recibos.length} recibos, ${anulados.length} de ellos ANULADOS`)
  for (const [k, v] of recibos.slice(0, 15)) console.log(`    ${k.padEnd(22)} estado ${txt(v?.estado).padEnd(4)} ${txt(v?.fecha)}`)
  if (recibos.length > 15) console.log(`    … y ${recibos.length - 15} más`)
}
console.log('\n  Si TODOS los recibos de acá están en ANU, la conclusión es que Tango')
console.log('  les borra el cliente al anularlos, y no que se hayan creado mal.\n')

// 5. La misma pregunta para los REMITOS (2026-09-20). Si Tango también les
// borra el cliente al anularlos, la reconciliación de remitos tenía el mismo
// defecto que la de recibos y tampoco iba a confirmar nunca. Si en cambio los
// miles de remitos del cajón están en otros estados, son los movimientos de
// stock entre depósitos que manda la app (merma al 99, diferencia al 98,
// camión a planta), que viven en la misma tabla y no tienen cliente.
console.log('══ Los remitos del cajón "sin cliente": ¿anulados, o movimientos de stock?\n')
for (const clave of ['redonhielo_000000', 'rolito_000000']) {
  const idx = await db.doc(`tangoComprobantes/${clave}`).get()
  if (!idx.exists) continue
  const remitos = Object.entries(idx.data()?.remitos ?? {})
  const porEstado = {}
  for (const [, v] of remitos) {
    const e = txt(v?.estado).toUpperCase() || '(vacío)'
    porEstado[e] = (porEstado[e] ?? 0) + 1
  }
  console.log(`  ${clave}: ${remitos.length} remitos`)
  for (const [e, n] of Object.entries(porEstado).sort((a, b) => b[1] - a[1])) {
    const ej = remitos.filter(([, v]) => (txt(v?.estado).toUpperCase() || '(vacío)') === e).slice(0, 3)
    console.log(`    estado ${e.padEnd(8)} ${String(n).padStart(5)}   ej. ${ej.map(([k, v]) => `${k} (${txt(v?.fecha)})`).join(', ')}`)
  }
  console.log('')
}
console.log('  "A" = anulado. Si son casi todos A, Tango hace con los remitos lo mismo')
console.log('  que con los recibos. Si son P/F u otros, son movimientos de stock.\n')

process.exit(0)
