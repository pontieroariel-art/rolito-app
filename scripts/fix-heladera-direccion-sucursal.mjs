/**
 * fix-heladera-direccion-sucursal.mjs
 * Corrige `clienteAsignadoDireccion` en heladeras cuya dirección quedó
 * apuntando al domicilio fiscal del cliente en vez de al de la sucursal.
 *
 * Causa: backfill-heladera-sucursal.mjs prefería la dirección de la ficha
 * del cliente (`addresses[].address`) sobre la del Excel histórico, pero en
 * los grupos con muchas sucursales (YPF, Delivery Hero, etc.) la ficha tiene
 * la MISMA dirección (la fiscal) cargada en decenas de sucursales, así que
 * todas las heladeras del cliente terminaron con "BOULEVARD MACACHA GUEMES
 * 515" aunque estén en Bernal, Nordelta o La Plata.
 *
 * Criterio: se toca una heladera solo si (a) su dirección actual la comparten
 * 2+ sucursales de la ficha del cliente y (b) el Excel tiene una dirección
 * distinta para esa fila. En ese caso se pisa con Dirección + Localidad del
 * Excel. Los tickets de service no cerrados de esas heladeras se actualizan
 * con la misma dirección. La ficha del cliente (`users.addresses[]`) NO se
 * toca — eso arrastra lat/lng y pedidos, se resuelve aparte.
 *
 * Uso:
 *   node scripts/fix-heladera-direccion-sucursal.mjs            → dry-run
 *   node scripts/fix-heladera-direccion-sucursal.mjs --commit    → escribe
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')
const XLSX      = require('../node_modules/xlsx/xlsx.js')

const EXCEL_PATH = 'C:/Users/Ariel/Desktop/info app heladeras/Listado de equipos APP (listado excel brian).xlsx'
const COMMIT      = process.argv.includes('--commit')

const serviceAccount = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const cleanStr = (v) => (v != null ? String(v).trim() : '')
const norm     = (s) => cleanStr(s).toUpperCase().replace(/\s+/g, ' ')

function parseExcelBySerie() {
  const wb    = XLSX.readFile(EXCEL_PATH)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw   = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  const all = raw.slice(1).map((r) => ({
    serie:     cleanStr(r['__EMPTY']),
    cliente:   cleanStr(r['__EMPTY_3']),
    direccion: cleanStr(r['__EMPTY_5']),
    localidad: cleanStr(r['__EMPTY_6']),
    estado:    cleanStr(r['__EMPTY_8']).toUpperCase(),
  }))
  // mismo criterio de dedupe que import-heladeras.mjs / backfill
  const bySerie = new Map()
  for (const r of all) {
    const prev = bySerie.get(r.serie)
    const score = (row) => (row.cliente ? 2 : 0) + (row.estado ? 1 : 0)
    if (!prev || score(r) > score(prev)) bySerie.set(r.serie, r)
  }
  return bySerie
}

async function main() {
  console.log(`Modo: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)
  const excel = parseExcelBySerie()

  const usersSnap = await db.collection('users').where('rol', '==', 'cliente').get()
  const users = new Map()
  usersSnap.forEach((d) => users.set(d.id, d.data()))

  const hSnap = await db.collection('heladeras').where('estado', '==', 'en_comodato').get()
  console.log(`Heladeras en_comodato: ${hSnap.size}`)

  const cambios = []   // { id, codigo, cliente, sucursal, antes, despues }
  let compartidaSinExcel = 0, compartidaMismaEnExcel = 0
  hSnap.forEach((d) => {
    const h = d.data()
    const u = users.get(h.clienteAsignadoId)
    if (!u || !h.clienteAsignadoDireccionId) return
    const addrs = u.addresses ?? []
    const comparten = addrs.filter((a) => norm(a.address) === norm(h.clienteAsignadoDireccion)).length
    if (comparten < 2) return
    const row = excel.get(h.numeroSerie)
    const excelDir = row ? [row.direccion, row.localidad].filter(Boolean).join(', ') : ''
    if (!excelDir) { compartidaSinExcel++; return }
    if (norm(excelDir) === norm(h.clienteAsignadoDireccion)) { compartidaMismaEnExcel++; return }
    if (row.cliente && row.cliente !== h.clienteAsignadoDireccionId) {
      console.log(`  ! ${h.codigoInterno}: el Excel dice sucursal ${row.cliente} pero la heladera tiene ${h.clienteAsignadoDireccionId} — se saltea`)
      return
    }
    cambios.push({ id: d.id, codigo: h.codigoInterno, cliente: h.clienteAsignadoNombre, sucursal: h.clienteAsignadoDireccionId, antes: h.clienteAsignadoDireccion, despues: excelDir })
  })

  // Tickets no cerrados de esas heladeras
  const porHeladera = new Map(cambios.map((c) => [c.id, c]))
  const tSnap = await db.collection('ticketsServicio').where('estado', 'in', ['abierto', 'asignado_tecnico', 'asignado_chofer']).get()
  const tickets = tSnap.docs.filter((d) => porHeladera.has(d.data().heladeraId))

  console.log(`\nHeladeras con dirección compartida por 2+ sucursales: ${cambios.length + compartidaSinExcel + compartidaMismaEnExcel}`)
  console.log(`  sin fila/dirección en el Excel (se dejan): ${compartidaSinExcel}`)
  console.log(`  el Excel tiene la misma dirección (se dejan): ${compartidaMismaEnExcel}`)
  console.log(`  ${COMMIT ? 'Corregidas' : 'A corregir'}: ${cambios.length}`)
  console.log(`  Tickets abiertos a actualizar: ${tickets.length}`)
  console.log('')
  for (const c of cambios.sort((a, b) => a.sucursal.localeCompare(b.sucursal))) {
    console.log(`  ${c.codigo} ${c.sucursal.padEnd(7)} ${c.cliente}\n      ${c.antes}\n   -> ${c.despues}`)
  }

  if (COMMIT) {
    let batch = db.batch(), ops = 0
    const flush = async () => { if (ops) { await batch.commit(); batch = db.batch(); ops = 0 } }
    for (const c of cambios) {
      batch.update(db.collection('heladeras').doc(c.id), { clienteAsignadoDireccion: c.despues })
      if (++ops >= 400) await flush()
    }
    for (const t of tickets) {
      batch.update(t.ref, { direccion: porHeladera.get(t.data().heladeraId).despues })
      if (++ops >= 400) await flush()
    }
    await flush()
    console.log('\nListo.')
  } else {
    console.log('\nDRY-RUN — no se escribió nada. Corré con --commit para aplicar.')
  }
  process.exit(0)
}

main().catch((err) => { console.error('Error fatal:', err); process.exit(1) })
