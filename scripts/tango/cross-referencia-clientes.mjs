/**
 * cross-referencia-clientes.mjs
 * Cruza los clientes de Tango (export de scripts/tango/export-clientes-tango.ps1)
 * contra los clientes de la app (Firestore, users donde rol == 'cliente') por CUIT.
 *
 * Es SOLO LECTURA — no escribe nada en Firestore. Genera un reporte para revisar
 * antes de decidir cómo guardar el codigoTango en el perfil del cliente.
 *
 * Uso:
 *   node scripts/tango/cross-referencia-clientes.mjs "C:/ruta/a/clientes-tango.json"
 */

import { readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json')
const TANGO_JSON_PATH      = process.argv[2]
const OUT_MATCHES          = path.join(__dirname, 'cruce-matches.json')
const OUT_SOLO_APP         = path.join(__dirname, 'cruce-solo-app.json')
const OUT_SOLO_TANGO       = path.join(__dirname, 'cruce-solo-tango.json')
const OUT_DUPLICADOS       = path.join(__dirname, 'cruce-duplicados.json')

if (!TANGO_JSON_PATH) {
  console.error('Uso: node scripts/tango/cross-referencia-clientes.mjs "C:/ruta/a/clientes-tango.json"')
  process.exit(1)
}

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

function soloDigitos(v) {
  return v != null ? String(v).replace(/\D/g, '') : ''
}

function leerJsonSinBom(rutaArchivo) {
  const texto = readFileSync(rutaArchivo, 'utf8')
  return JSON.parse(texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto)
}

async function main() {
  // ── Cargar clientes de Tango ────────────────────────────────────────────
  const tangoRaw = leerJsonSinBom(TANGO_JSON_PATH)
  console.log(`Tango: ${tangoRaw.length} clientes`)

  const tangoPorCuit = new Map() // cuitDigits -> [registros tango]
  let tangoSinCuit = 0
  for (const t of tangoRaw) {
    const cuit = soloDigitos(t.cuit)
    if (cuit.length < 6) { tangoSinCuit++; continue }
    if (!tangoPorCuit.has(cuit)) tangoPorCuit.set(cuit, [])
    tangoPorCuit.get(cuit).push(t)
  }
  console.log(`  con CUIT válido: ${tangoRaw.length - tangoSinCuit}  |  sin CUIT: ${tangoSinCuit}`)
  console.log(`  CUITs únicos en Tango: ${tangoPorCuit.size}`)

  // ── Cargar clientes de la app (Firestore) ───────────────────────────────
  const snap = await db.collection('users').where('rol', '==', 'cliente').get()
  console.log(`App: ${snap.size} usuarios con rol=cliente`)

  const appPorCuit = new Map() // cuitDigits -> [docs app]
  let appSinCuit = 0
  snap.forEach((doc) => {
    const data = doc.data()
    const cuit = soloDigitos(data.cuit)
    if (cuit.length < 6) { appSinCuit++; return }
    if (!appPorCuit.has(cuit)) appPorCuit.set(cuit, [])
    appPorCuit.get(cuit).push({ uid: doc.id, ...data })
  })
  console.log(`  con CUIT válido: ${snap.size - appSinCuit}  |  sin CUIT: ${appSinCuit}`)
  console.log(`  CUITs únicos en la app: ${appPorCuit.size}`)

  // ── Cruce ────────────────────────────────────────────────────────────────
  const matches = []
  const soloApp = []
  const duplicados = [] // CUITs con más de un registro de un lado o del otro

  for (const [cuit, appRegs] of appPorCuit.entries()) {
    const tangoRegs = tangoPorCuit.get(cuit)
    if (!tangoRegs) {
      for (const a of appRegs) {
        soloApp.push({ uid: a.uid, codigoCliente: a.codigoCliente ?? null, cuit, razonSocial: a.razonSocial ?? null })
      }
      continue
    }
    if (appRegs.length > 1 || tangoRegs.length > 1) {
      duplicados.push({
        cuit,
        app: appRegs.map((a) => ({ uid: a.uid, codigoCliente: a.codigoCliente ?? null, razonSocial: a.razonSocial ?? null })),
        tango: tangoRegs.map((t) => ({ idGva14: t.idGva14, codGva14: t.codGva14, razonSocial: t.razonSocial })),
      })
      continue
    }
    const a = appRegs[0]
    const t = tangoRegs[0]
    matches.push({
      uid: a.uid,
      codigoCliente: a.codigoCliente ?? null,
      razonSocialApp: a.razonSocial ?? null,
      cuit,
      codigoTango: t.codGva14,
      idGva14Tango: t.idGva14,
      razonSocialTango: t.razonSocial,
    })
  }

  const soloTango = []
  for (const [cuit, tangoRegs] of tangoPorCuit.entries()) {
    if (!appPorCuit.has(cuit)) {
      for (const t of tangoRegs) {
        soloTango.push({ codigoTango: t.codGva14, idGva14Tango: t.idGva14, cuit, razonSocial: t.razonSocial })
      }
    }
  }

  writeFileSync(OUT_MATCHES, JSON.stringify(matches, null, 2), 'utf8')
  writeFileSync(OUT_SOLO_APP, JSON.stringify(soloApp, null, 2), 'utf8')
  writeFileSync(OUT_SOLO_TANGO, JSON.stringify(soloTango, null, 2), 'utf8')
  writeFileSync(OUT_DUPLICADOS, JSON.stringify(duplicados, null, 2), 'utf8')

  console.log('')
  console.log('── Resultado del cruce ──────────────────────────────')
  console.log(`Matches 1-a-1 por CUIT:        ${matches.length}  -> ${OUT_MATCHES}`)
  console.log(`Solo en la app (sin Tango):    ${soloApp.length}  -> ${OUT_SOLO_APP}`)
  console.log(`Solo en Tango (sin app):       ${soloTango.length}  -> ${OUT_SOLO_TANGO}`)
  console.log(`CUITs con duplicados:          ${duplicados.length}  -> ${OUT_DUPLICADOS}`)
  console.log(`App sin CUIT cargado:          ${appSinCuit}`)
  console.log(`Tango sin CUIT válido:         ${tangoSinCuit}`)
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
