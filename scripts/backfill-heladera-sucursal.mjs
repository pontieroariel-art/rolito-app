/**
 * backfill-heladera-sucursal.mjs
 * Completa clienteAsignadoDireccionId/clienteAsignadoDireccion en las
 * heladeras que ya se importaron (scripts/import-heladeras.mjs) sin ese dato
 * — necesario para saber a qué SUCURSAL puntual del cliente pertenece cada
 * equipo (clientes con muchas sucursales bajo un mismo CUIT, ej. YPF, Pan
 * American, cadenas — antes solo quedaba el cliente "padre", sin la
 * sucursal). Reconstruye el dato desde el mismo Excel histórico: la columna
 * "Cliente" de cada fila ES el id de la sucursal (`addresses[].id`) en el
 * cliente ya matcheado.
 *
 * Uso:
 *   node scripts/backfill-heladera-sucursal.mjs            → dry-run
 *   node scripts/backfill-heladera-sucursal.mjs --commit    → escribe
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
const FieldValue = admin.firestore.FieldValue

function cleanStr(v) { return v != null ? String(v).trim() : '' }

function parseExcelRows() {
  const wb    = XLSX.readFile(EXCEL_PATH)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw   = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  const all = raw.slice(1).map((r) => ({
    serie:       cleanStr(r['__EMPTY']),
    cliente:     cleanStr(r['__EMPTY_3']),
    razonSocial: cleanStr(r['__EMPTY_4']),
    direccion:   cleanStr(r['__EMPTY_5']),
    localidad:   cleanStr(r['__EMPTY_6']),
    estado:      cleanStr(r['__EMPTY_8']).toUpperCase(),
  }))
  // mismo criterio de dedupe que import-heladeras.mjs
  const bySerie = new Map()
  for (const r of all) {
    const prev = bySerie.get(r.serie)
    if (!prev) { bySerie.set(r.serie, r); continue }
    const score = (row) => (row.cliente ? 2 : 0) + (row.estado ? 1 : 0)
    if (score(r) > score(prev)) bySerie.set(r.serie, r)
  }
  return [...bySerie.values()].filter((r) => r.estado === 'ASIGNADO' && r.cliente && !r.cliente.toUpperCase().includes('AJUSTE'))
}

async function main() {
  console.log(`Modo: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  const rows = parseExcelRows()
  console.log(`Filas ASIGNADO en el Excel: ${rows.length}`)

  console.log('Cargando heladeras en_comodato sin sucursal...')
  const heladerasSnap = await db.collection('heladeras').where('estado', '==', 'en_comodato').get()
  const bySerie = new Map()
  heladerasSnap.forEach((d) => bySerie.set(d.data().numeroSerie, { id: d.id, ...d.data() }))
  console.log(`Heladeras en_comodato en Firestore: ${bySerie.size}`)

  // Cache de clientes ya leídos (muchas filas comparten el mismo cliente)
  const clienteCache = new Map()
  async function getCliente(uid) {
    if (clienteCache.has(uid)) return clienteCache.get(uid)
    const snap = await db.collection('users').doc(uid).get()
    const data = snap.exists ? snap.data() : null
    clienteCache.set(uid, data)
    return data
  }

  let yaTenian = 0, actualizadas = 0, sinHeladera = 0, sinDireccionEnFicha = 0
  let batch = db.batch()
  let opsEnBatch = 0

  for (const row of rows) {
    const h = bySerie.get(row.serie)
    if (!h) { sinHeladera++; continue }
    if (h.clienteAsignadoDireccionId) { yaTenian++; continue }
    if (!h.clienteAsignadoId) continue

    const cliente = await getCliente(h.clienteAsignadoId)
    const direccionFicha = (cliente?.addresses ?? []).find((a) => a.id === row.cliente)
    const direccionTexto = direccionFicha?.address || [row.direccion, row.localidad].filter(Boolean).join(', ')
    if (!direccionFicha) sinDireccionEnFicha++

    actualizadas++
    if (COMMIT) {
      batch.update(db.collection('heladeras').doc(h.id), {
        clienteAsignadoDireccionId: row.cliente,
        clienteAsignadoDireccion:   direccionTexto || null,
      })
      opsEnBatch++
      if (opsEnBatch >= 400) {
        await batch.commit()
        batch = db.batch()
        opsEnBatch = 0
        process.stdout.write(`\r  ${actualizadas}/${rows.length}   `)
      }
    }
  }
  if (COMMIT && opsEnBatch > 0) await batch.commit()

  console.log(`\n\n── Resultado ────────────────────────────────`)
  console.log(`  Ya tenían sucursal (salteadas): ${yaTenian}`)
  console.log(`  ${COMMIT ? 'Actualizadas' : 'A actualizar'}: ${actualizadas}`)
  console.log(`  Sin esa dirección en la ficha del cliente (se usó Dirección+Localidad del Excel): ${sinDireccionEnFicha}`)
  console.log(`  Filas sin heladera correspondiente en Firestore: ${sinHeladera}`)

  if (!COMMIT) console.log('\nDRY-RUN — no se escribió nada. Corré con --commit para aplicar.')
  process.exit(0)
}

main().catch((err) => { console.error('Error fatal:', err); process.exit(1) })
