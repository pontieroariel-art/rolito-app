/**
 * import-heladeras.mjs
 * Importación masiva del listado histórico de heladeras (Excel de Brian) a
 * Firestore de producción: crea documentos en `heladeras`, crea modelos
 * faltantes en `modelosHeladera`, y crea fichas de cliente livianas (sin
 * cuenta de login) en `users` para equipos asignados a negocios que no
 * tienen cuenta en la app.
 *
 * Uso:
 *   node scripts/import-heladeras.mjs                 → dry-run (no escribe nada)
 *   node scripts/import-heladeras.mjs --commit         → escribe en Firestore
 *   $env:GMAPS_KEY="..."; node scripts/import-heladeras.mjs --commit   → además geocodifica clientes nuevos
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')
const XLSX      = require('../node_modules/xlsx/xlsx.js')

// ── Configuración ────────────────────────────────────────────────────────────

const EXCEL_PATH   = 'C:/Users/Ariel/Desktop/info app heladeras/Listado de equipos APP (listado excel brian).xlsx'
const COMMIT        = process.argv.includes('--commit')
const LOG_PATH       = path.join(__dirname, 'import-heladeras-log.txt')

// Key de Google Maps: la misma del .env.local del front (VITE_GOOGLE_MAPS_API_KEY),
// o GMAPS_KEY si se pasa explícita. Sin key, los clientes nuevos quedan sin geocodificar
// (lat/lng null) y se pueden geocodificar después con scripts/geocode-clientes.mjs.
function loadGmapsKey() {
  if (process.env.GMAPS_KEY) return process.env.GMAPS_KEY
  const envPath = path.join(__dirname, '..', '.env.local')
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf8').match(/^VITE_GOOGLE_MAPS_API_KEY=(.+)$/m)
    if (m) return m[1].trim()
  }
  return null
}
const GMAPS_KEY = loadGmapsKey()

const serviceAccount = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()
const FieldValue = admin.firestore.FieldValue
const Timestamp  = admin.firestore.Timestamp

// ── Helpers ──────────────────────────────────────────────────────────────────

function cleanStr(v) { return v != null ? String(v).trim() : '' }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function parseFechaDDMMYYYY(s) {
  const m = cleanStr(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  return new Date(Number(y), Number(mo) - 1, Number(d))
}

async function geocode(address) {
  if (!GMAPS_KEY) return null
  const query = encodeURIComponent(address + ', Argentina')
  const url   = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&region=ar&language=es&key=${GMAPS_KEY}`
  try {
    const res  = await fetch(url)
    const data = await res.json()
    if (data.status !== 'OK' || !data.results?.length) return null
    const loc = data.results[0].geometry.location
    return { lat: loc.lat, lng: loc.lng }
  } catch {
    return null
  }
}

// ── 1. Parsear Excel ─────────────────────────────────────────────────────────

function parseExcel() {
  const wb    = XLSX.readFile(EXCEL_PATH)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw   = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  const all = raw.slice(1).map((r) => ({
    serie:       cleanStr(r['__EMPTY']),
    color:       cleanStr(r['__EMPTY_1']),
    modelo:      cleanStr(r['__EMPTY_2']),
    cliente:     cleanStr(r['__EMPTY_3']),
    razonSocial: cleanStr(r['__EMPTY_4']),
    direccion:   cleanStr(r['__EMPTY_5']),
    localidad:   cleanStr(r['__EMPTY_6']),
    fabricacion: cleanStr(r['__EMPTY_7']),
    estado:      cleanStr(r['__EMPTY_8']).toUpperCase(),
  }))

  // Dedupe por serie: si hay más de una fila con la misma serie, preferir la
  // que tiene datos (cliente/estado) por sobre una fila vacía duplicada.
  const bySerie = new Map()
  for (const r of all) {
    const prev = bySerie.get(r.serie)
    if (!prev) { bySerie.set(r.serie, r); continue }
    const score = (row) => (row.cliente ? 2 : 0) + (row.estado ? 1 : 0)
    if (score(r) > score(prev)) bySerie.set(r.serie, r)
  }
  return [...bySerie.values()]
}

// ── 2. Clasificar filas contra clientes existentes ──────────────────────────

async function cargarClientesExistentes() {
  const snap = await db.collection('users').where('rol', '==', 'cliente').get()
  const byCodigo = new Map()   // código → {uid, razonSocial}
  const byRazon  = new Map()   // razonSocial upper → {uid, razonSocial}
  snap.forEach((doc) => {
    const d = doc.data()
    const info = { uid: doc.id, razonSocial: d.razonSocial || d.nombre || '' }
    const codes = new Set()
    if (d.codigoCliente) codes.add(cleanStr(d.codigoCliente))
    for (const a of d.addresses || []) {
      if (a.codigoCliente) codes.add(cleanStr(a.codigoCliente))
      if (a.id) codes.add(cleanStr(a.id))
    }
    for (const c of codes) if (!byCodigo.has(c)) byCodigo.set(c, info)
    const rn = cleanStr(d.razonSocial).toUpperCase()
    if (rn && !byRazon.has(rn)) byRazon.set(rn, info)
  })
  return { byCodigo, byRazon }
}

async function cargarModelosExistentes() {
  const snap = await db.collection('modelosHeladera').get()
  const byNombre = new Map()
  snap.forEach((doc) => byNombre.set(cleanStr(doc.data().nombre).toUpperCase(), { id: doc.id, ...doc.data() }))
  return byNombre
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Modo: ${COMMIT ? 'COMMIT (escribe en Firestore)' : 'DRY-RUN (solo reporte, no escribe nada)'}`)
  if (COMMIT && !GMAPS_KEY) console.log('⚠ Sin GMAPS_KEY: los clientes nuevos quedarán sin geocodificar (lat/lng null).')

  const rows = parseExcel()
  console.log(`\nFilas únicas por serie: ${rows.length}`)

  const ajuste    = rows.filter((r) => r.cliente.toUpperCase() === 'AJUSTE' || r.razonSocial.toUpperCase().includes('AJUSTE'))
  const ajusteSet = new Set(ajuste.map((r) => r.serie))
  const usable    = rows.filter((r) => !ajusteSet.has(r.serie))
  console.log(`Excluidas por ser "CLIENTE DE AJUSTE" (no es un cliente real): ${ajuste.length}`)

  const asignadas = usable.filter((r) => r.estado === 'ASIGNADO')
  const sinCliente = usable.filter((r) => r.estado !== 'ASIGNADO')   // DEPOSITO / DISPONIBLE / en blanco → disponible

  const { byCodigo, byRazon } = await cargarClientesExistentes()

  const matched   = []   // { row, uid, razonSocial }
  const unmatched = []   // { row }
  for (const r of asignadas) {
    const hit = byCodigo.get(r.cliente) || byRazon.get(r.razonSocial.toUpperCase())
    if (hit) matched.push({ row: r, uid: hit.uid, razonSocial: hit.razonSocial })
    else unmatched.push({ row: r })
  }

  // Clientes livianos nuevos: uno por código único sin match (no por fila).
  const nuevosPorCodigo = new Map()   // código → { codigo, razonSocial, direccion, localidad }
  for (const { row } of unmatched) {
    if (!nuevosPorCodigo.has(row.cliente)) {
      nuevosPorCodigo.set(row.cliente, {
        codigo: row.cliente, razonSocial: row.razonSocial,
        direccion: row.direccion, localidad: row.localidad,
      })
    }
  }

  console.log(`\n── Clientes (equipos ASIGNADO: ${asignadas.length}) ──────────────`)
  console.log(`  Matchean con cliente existente:        ${matched.length}`)
  console.log(`  Sin cuenta en la app (fila):            ${unmatched.length}`)
  console.log(`  → clientes livianos nuevos a crear:     ${nuevosPorCodigo.size}`)
  console.log(`\n── Sin cliente asignado (DEPOSITO/DISPONIBLE/en blanco) ──`)
  console.log(`  Total: ${sinCliente.length}`)

  // Modelos
  const modelosExistentes = await cargarModelosExistentes()
  const modelosEnExcel = new Map()   // nombre → maxNumero
  for (const r of usable) {
    if (!r.modelo) continue
    const numMatch = r.serie.match(/(\d+)$/)
    const num = numMatch ? parseInt(numMatch[1], 10) : 0
    const cur = modelosEnExcel.get(r.modelo) || 0
    if (num > cur) modelosEnExcel.set(r.modelo, num)
  }
  const modelosNuevos = [...modelosEnExcel.keys()].filter((m) => !modelosExistentes.has(m.toUpperCase()))
  console.log(`\n── Modelos ──────────────────────────────────`)
  console.log(`  Ya existen en Firestore: ${[...modelosExistentes.keys()].join(', ') || '(ninguno)'}`)
  console.log(`  A crear (${modelosNuevos.length}): ${modelosNuevos.join(', ')}`)

  console.log(`\n── Resumen final de heladeras a importar ──────`)
  console.log(`  Total a crear:      ${matched.length + unmatched.length + sinCliente.length}`)
  console.log(`  → en_comodato:      ${matched.length + unmatched.length}`)
  console.log(`  → disponible:       ${sinCliente.length}`)
  console.log(`  Excluidas (AJUSTE): ${ajuste.length}`)

  if (!COMMIT) {
    writeFileSync(LOG_PATH, [
      'Clientes nuevos a crear:',
      ...[...nuevosPorCodigo.values()].map((c) => `  ${c.codigo}\t${c.razonSocial}\t${c.direccion}, ${c.localidad}`),
      '',
      'Modelos nuevos a crear:',
      ...modelosNuevos.map((m) => `  ${m} (proximoNumero=${modelosEnExcel.get(m) + 1})`),
    ].join('\n'), 'utf8')
    console.log(`\nDetalle guardado en: ${LOG_PATH}`)
    console.log('\nDRY-RUN — no se escribió nada. Corré con --commit para aplicar.')
    process.exit(0)
  }

  // ── COMMIT ───────────────────────────────────────────────────────────────

  console.log('\n── Creando modelos nuevos ──────────────────────')
  const modeloIdByNombre = new Map()
  for (const [nombre, info] of modelosExistentes) modeloIdByNombre.set(nombre, info.id)
  for (const nombre of modelosNuevos) {
    const ref = db.collection('modelosHeladera').doc()
    await ref.set({
      nombre,
      medidas: { ancho: 0, alto: 0, profundo: 0 },
      capacidadBolsas: 0,
      activo: true,
      prefijoCodigo: nombre,
      proximoNumero: modelosEnExcel.get(nombre) + 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    modeloIdByNombre.set(nombre.toUpperCase(), ref.id)
    console.log(`  + ${nombre} (${ref.id})`)
  }

  console.log('\n── Creando clientes livianos nuevos ────────────')
  const uidByCodigo = new Map()
  let geocoded = 0, sinGeocodificar = 0
  let i = 0
  for (const c of nuevosPorCodigo.values()) {
    i++
    const direccionCompleta = [c.direccion, c.localidad].filter(Boolean).join(', ')
    let lat = null, lng = null
    if (direccionCompleta) {
      await sleep(120)
      const coords = await geocode(direccionCompleta)
      if (coords) { lat = coords.lat; lng = coords.lng; geocoded++ } else sinGeocodificar++
    }
    const ref = db.collection('users').doc()
    await ref.set({
      nombre:          c.razonSocial || c.codigo,
      nombreContacto:  c.razonSocial || c.codigo,
      razonSocial:     c.razonSocial || c.codigo,
      cuit:            '',
      email:           '',
      phone:           '',
      telefono:        '',
      rol:             'cliente',
      estado:          'activo',
      codigoCliente:   c.codigo,
      address:         direccionCompleta,
      lat, lng,
      addresses: [{
        id: c.codigo,
        nombre: c.razonSocial || c.codigo,
        address: direccionCompleta,
        lat, lng,
        horarioApertura: '', horarioCierre: '',
        contactoNombre: '', contactoTelefono: '',
        esPrincipal: true,
        codigoCliente: c.codigo,
      }],
      observaciones: 'Cliente importado desde el listado histórico de equipos (heladeras). Sin cuenta de acceso a la app — creado solo para asignación de equipos.',
      fechaCreacion:   FieldValue.serverTimestamp(),
      fechaAprobacion: FieldValue.serverTimestamp(),
      aprobadoPor:     'importacion-heladeras',
    })
    uidByCodigo.set(c.codigo, { uid: ref.id, nombre: c.razonSocial || c.codigo })
    if (i % 25 === 0 || i === nuevosPorCodigo.size) {
      process.stdout.write(`\r  ${i}/${nuevosPorCodigo.size} · geocodificados ${geocoded} · sin geocodificar ${sinGeocodificar}   `)
    }
  }
  console.log('')

  console.log('\n── Creando heladeras ────────────────────────────')
  console.log('  Chequeando heladeras ya cargadas (idempotencia)...')
  const yaCreadasSnap = await db.collection('heladeraCodigoIndex').get()
  const yaCreadas = new Set(yaCreadasSnap.docs.map((d) => d.id))
  console.log(`  Ya existentes (se saltean): ${yaCreadas.size}`)

  const todasSinFiltrar = [
    ...matched.map(({ row, uid, razonSocial }) => ({ row, cliente: { uid, nombre: razonSocial } })),
    ...unmatched.map(({ row }) => ({ row, cliente: uidByCodigo.get(row.cliente) })),
    ...sinCliente.map((row) => ({ row, cliente: null })),
  ]
  const todas = todasSinFiltrar.filter(({ row }) => !yaCreadas.has(row.serie))
  console.log(`  A crear en esta corrida: ${todas.length}`)

  let batch = db.batch()
  let opsEnBatch = 0
  let creadas = 0
  const actor = { uid: 'import-script', nombre: 'Importación masiva (histórico Excel)' }

  for (const { row, cliente } of todas) {
    const modeloId = modeloIdByNombre.get(row.modelo.toUpperCase()) || null
    const fabricacionDate = parseFechaDDMMYYYY(row.fabricacion)
    const fechaIngreso = fabricacionDate ? Timestamp.fromDate(fabricacionDate) : FieldValue.serverTimestamp()

    const heladeraRef = db.collection('heladeras').doc()
    const codigoRef   = db.collection('heladeraCodigoIndex').doc(row.serie)

    const historial = [{
      accion: 'creada', usuarioId: actor.uid, usuarioNombre: actor.nombre,
      timestamp: fechaIngreso instanceof Timestamp ? fechaIngreso : Timestamp.now(),
      detalle: 'Importación masiva desde listado histórico de equipos', estadoOrigen: null, estadoDestino: null,
      pasoId: null, tiposReparacion: null,
    }]
    if (cliente) {
      historial.push({
        accion: 'asignada', usuarioId: actor.uid, usuarioNombre: actor.nombre,
        timestamp: fechaIngreso instanceof Timestamp ? fechaIngreso : Timestamp.now(),
        detalle: `A ${cliente.nombre} (importación histórica)`, estadoOrigen: null, estadoDestino: null,
        pasoId: null, tiposReparacion: null,
      })
    }

    batch.set(heladeraRef, {
      numeroSerie:   row.serie,
      codigoInterno: row.serie,
      modeloId,
      modelo:        row.modelo,
      estado:        cliente ? 'en_comodato' : 'disponible',
      tipoPipeline:  'fabricacion',
      pasoActualId:  null,
      primerPasoId:  null,
      motivoIngresoId: null, motivoIngresoNombre: null, tipoOperacion: null,
      observacionesIngreso: row.color ? `Color: ${row.color}. Importado desde listado histórico de equipos.` : 'Importado desde listado histórico de equipos.',
      creadoPor: actor,
      fechaIngreso,
      cicloActual: 1,
      motivoBaja: null,
      enProceso: null,
      clienteAsignadoId:     cliente ? cliente.uid : null,
      clienteAsignadoNombre: cliente ? cliente.nombre : null,
      fechaAsignacion:       cliente ? fechaIngreso : null,
      historialAcciones: historial,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    batch.set(codigoRef, { heladeraId: heladeraRef.id })
    opsEnBatch += 2
    creadas++

    if (opsEnBatch >= 400) {
      await batch.commit()
      batch = db.batch()
      opsEnBatch = 0
      process.stdout.write(`\r  ${creadas}/${todas.length}   `)
    }
  }
  if (opsEnBatch > 0) await batch.commit()
  console.log(`\r  ${creadas}/${todas.length}   `)

  console.log('\n¡Listo!')
  console.log(`  Heladeras creadas:        ${creadas}`)
  console.log(`  Clientes nuevos creados:  ${uidByCodigo.size}`)
  console.log(`  Modelos nuevos creados:   ${modelosNuevos.length}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Error fatal:', err)
  process.exit(1)
})
