/**
 * cruce-por-codigo.mjs
 * Cruza los clientes de la app SIN CUIT (típicamente los 153 del import de
 * heladeras) contra Tango por codigoCliente == COD_GVA14, la misma lógica que
 * resolvió los "grupos empresarios" en el cruce por CUIT del 26/08.
 *
 * Fuente Tango: por defecto usa scripts/tango/cruce-solo-tango.json (los
 * clientes de Tango con CUIT que quedaron sin matchear en el cruce anterior).
 * Si se pasa un export completo fresco (clientes-tango.json de
 * export-clientes-tango.ps1) como argumento, usa ese — cubre también los
 * clientes de Tango sin CUIT, que el archivo por defecto no incluye.
 *
 * Dry-run por defecto (solo reporte). Con --commit backfillea en Firestore:
 * cuit (solo si el cliente no tiene), codigoTango e idGva14Tango. El resto de
 * los campos los trae solo el sync diario ya programado.
 *
 * Uso:
 *   node scripts/tango/cruce-por-codigo.mjs                        # dry-run
 *   node scripts/tango/cruce-por-codigo.mjs --commit
 *   node scripts/tango/cruce-por-codigo.mjs "C:/ruta/clientes-tango.json" --commit
 */

import { readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json')
const DEFAULT_TANGO_PATH   = path.join(__dirname, 'cruce-solo-tango.json')
const OUT_REPORTE          = path.join(__dirname, 'cruce-codigo-reporte.json')

const args      = process.argv.slice(2)
const COMMIT    = args.includes('--commit')
const tangoPath = args.find((a) => a !== '--commit') ?? DEFAULT_TANGO_PATH

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const soloDigitos = (v) => (v != null ? String(v).replace(/\D/g, '') : '')
// CUIT usable como clave de matcheo: 11 dígitos y no todo ceros (Tango tiene "00000000000")
const cuitValido  = (digits) => digits.length >= 6 && !/^0+$/.test(digits)
const normCodigo  = (v) => (v != null ? String(v).trim().toUpperCase() : '')

function leerJsonSinBom(rutaArchivo) {
  const texto = readFileSync(rutaArchivo, 'utf8')
  return JSON.parse(texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto)
}

async function main() {
  // ── Cargar clientes de Tango (acepta ambos formatos de archivo) ─────────
  const tangoRaw = leerJsonSinBom(tangoPath).map((t) => ({
    codigoTango: t.codigoTango ?? t.codGva14,
    idGva14Tango: t.idGva14Tango ?? t.idGva14,
    cuit: cuitValido(soloDigitos(t.cuit)) ? soloDigitos(t.cuit) : '',
    razonSocial: t.razonSocial ?? null,
  }))
  console.log(`Tango (${path.basename(tangoPath)}): ${tangoRaw.length} clientes`)

  // ── Cargar clientes de la app ───────────────────────────────────────────
  const snap = await db.collection('users').where('rol', '==', 'cliente').get()
  console.log(`App: ${snap.size} usuarios con rol=cliente`)

  const yaVinculados = new Set() // idGva14Tango ya tomados por algún cliente
  const sinVincular  = []        // candidatos: sin CUIT válido y sin idGva14Tango
  snap.forEach((doc) => {
    const d = doc.data()
    if (d.idGva14Tango != null) { yaVinculados.add(d.idGva14Tango); return }
    if (cuitValido(soloDigitos(d.cuit))) return // esos van por el cruce por CUIT
    const codigos = new Set(
      [d.codigoCliente, ...(d.addresses ?? []).map((a) => a?.codigoCliente)]
        .map(normCodigo).filter(Boolean),
    )
    sinVincular.push({ uid: doc.id, razonSocial: d.razonSocial ?? d.nombre ?? null, tieneCuit: false, codigos: [...codigos] })
  })
  console.log(`  sin CUIT y sin vincular a Tango: ${sinVincular.length}`)

  // ── Indexar Tango por código normalizado (excluyendo ya vinculados) ─────
  const tangoPorCodigo = new Map()
  for (const t of tangoRaw) {
    if (yaVinculados.has(t.idGva14Tango)) continue
    const cod = normCodigo(t.codigoTango)
    if (!cod) continue
    if (!tangoPorCodigo.has(cod)) tangoPorCodigo.set(cod, [])
    tangoPorCodigo.get(cod).push(t)
  }

  // ── Cruce ───────────────────────────────────────────────────────────────
  const matches = []
  const ambiguos = []
  const sinMatch = []
  const tomados = new Set() // idGva14 reclamados en esta corrida, evita pisadas

  for (const c of sinVincular) {
    const candidatos = []
    for (const cod of c.codigos) {
      for (const t of tangoPorCodigo.get(cod) ?? []) {
        if (!tomados.has(t.idGva14Tango) && !candidatos.includes(t)) candidatos.push(t)
      }
    }
    if (candidatos.length === 1) {
      const t = candidatos[0]
      tomados.add(t.idGva14Tango)
      matches.push({
        uid: c.uid, razonSocialApp: c.razonSocial, codigos: c.codigos,
        codigoTango: t.codigoTango, idGva14Tango: t.idGva14Tango,
        cuitTango: t.cuit || null, razonSocialTango: t.razonSocial,
      })
    } else if (candidatos.length > 1) {
      ambiguos.push({ uid: c.uid, razonSocialApp: c.razonSocial, codigos: c.codigos, candidatos })
    } else {
      sinMatch.push({ uid: c.uid, razonSocialApp: c.razonSocial, codigos: c.codigos })
    }
  }

  writeFileSync(OUT_REPORTE, JSON.stringify({ matches, ambiguos, sinMatch }, null, 2), 'utf8')

  console.log('')
  console.log('── Resultado del cruce por código ───────────────────')
  console.log(`Matches únicos:   ${matches.length}`)
  console.log(`Ambiguos (skip):  ${ambiguos.length}`)
  console.log(`Sin match:        ${sinMatch.length}`)
  console.log(`Reporte completo: ${OUT_REPORTE}`)

  for (const m of matches.slice(0, 15)) {
    console.log(`  ${m.codigos.join('/')} -> Tango ${m.codigoTango} (${m.razonSocialTango})${m.cuitTango ? ` CUIT ${m.cuitTango}` : ''}`)
  }
  if (matches.length > 15) console.log(`  ... y ${matches.length - 15} más (ver reporte)`)

  if (!COMMIT) {
    console.log('\nDry-run: no se escribió nada. Repetir con --commit para aplicar.')
    return
  }

  // ── Commit: backfill cuit + codigoTango + idGva14Tango ──────────────────
  let batch = db.batch()
  let enBatch = 0
  let escritos = 0
  for (const m of matches) {
    const update = { codigoTango: m.codigoTango, idGva14Tango: m.idGva14Tango }
    if (m.cuitTango) update.cuit = m.cuitTango
    batch.update(db.collection('users').doc(m.uid), update)
    if (++enBatch >= 400) { await batch.commit(); escritos += enBatch; batch = db.batch(); enBatch = 0 }
  }
  if (enBatch > 0) { await batch.commit(); escritos += enBatch }
  console.log(`\nListo -- ${escritos} usuarios vinculados a Tango (el sync diario completa el resto de los campos).`)
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
