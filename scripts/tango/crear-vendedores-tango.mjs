/**
 * crear-vendedores-tango.mjs — da de alta en Tango (GVA23, process 952, vía Tango
 * Connect) un VENDEDOR por chofer de la app y el vendedor de respaldo "AP - APP
 * ROLITO", y deja el mapeo en config/tango (docs/tango/INTEGRACION.md §24bis).
 *
 * Por qué: toda factura de Tango lleva vendedor, y la app manda al chofer logueado
 * como vendedor (decisión 2026-09-03). Los repartidores no existían como
 * vendedores (solo Sergio Alvarez, AS), así que las facturas promo de los demás
 * quedaban en reintento. Código de vendedor = NÚMERO DEL DEPÓSITO del chofer
 * (21 Primiterra, 04 Gallo, 03 Alvarez…): la misma identidad que ya tiene su camión
 * en Tango, entra en los 2 caracteres de COD_GVA23 y no choca con los vendedores
 * existentes (las iniciales sí: DA, GG, ME ya estaban tomados). Nombre = el de la
 * app en mayúsculas. Sergio tenía AS: queda en Tango para el historial, la app usa 03.
 *
 *   node scripts/tango/crear-vendedores-tango.mjs --company 5            → plan (no crea nada)
 *   node scripts/tango/crear-vendedores-tango.mjs --company 5 --commit   → crea en esa empresa
 *   node scripts/tango/crear-vendedores-tango.mjs --config               → escribe config/tango:
 *        vendedores[uid] = código, facturador.redonhielo.vendedor = 'AP', facturador.rolito.vendedor = 'AP'
 *        (correrlo DESPUÉS de crear en las empresas reales, 1 y 3)
 *
 * Token: env TANGO_TOKEN o scripts/tango/bridge-sync-clientes.config.json (tangoToken).
 */
import { readFileSync, existsSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')

const args    = process.argv.slice(2)
const COMMIT  = args.includes('--commit')
const CONFIG  = args.includes('--config')
const arg     = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const COMPANY = arg('--company')
const BASE    = process.env.TANGO_BASE_URL ?? 'https://001174-003.connect.axoft.com'
const RESPALDO = { codigo: 'AP', nombre: 'APP ROLITO' }

if (process.env.FIRESTORE_EMULATOR_HOST) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'rolito-app' })
} else {
  const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(sa) })
}
const db = admin.firestore()

function token() {
  if (process.env.TANGO_TOKEN) return process.env.TANGO_TOKEN
  const p = path.join(__dirname, 'bridge-sync-clientes.config.json')
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')).tangoToken
  throw new Error('Falta el token: env TANGO_TOKEN o scripts/tango/bridge-sync-clientes.config.json')
}
const headers = (company) => ({ ApiAuthorization: token(), Company: String(company), 'Content-Type': 'application/json' })

async function vendedoresTango(company) {
  const all = []; let i = 0, pages = 1
  do {
    const r = await fetch(`${BASE}/Api/Get?process=952&pageSize=500&pageIndex=${i}&view=`, { headers: headers(company) })
    const j = await r.json()
    if (!j.succeeded) throw new Error(`Tango (vendedores): ${j.exceptionInfo?.messages?.join('; ') ?? j.message}`)
    all.push(...j.resultData.list); pages = j.resultData.totalPages; i++
  } while (i < pages)
  return all
}

async function crearVendedor(company, codigo, nombre) {
  const body = { COD_GVA23: codigo, NOMBRE_VEN: nombre, INHABILITA: false, PORC_COMIS: 0, ID_TIPO_DOCUMENTO_GV: 41, TIPO_DOC: '99', NRO_DOC: '' }
  const r = await fetch(`${BASE}/Api/Create?process=952`, { method: 'POST', headers: headers(company), body: JSON.stringify(body) })
  const j = await r.json()
  if (!j.succeeded) throw new Error(`Tango no creó ${codigo}: ${j.exceptionInfo?.messages?.join('; ') ?? j.message}`)
  return j.savedId
}

const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const nombreTango = (s) => sinAcentos(String(s)).toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 30)

// ── Plan: un vendedor por chofer con depósito ────────────────────────────────
const tcfg = (await db.doc('config/tango').get()).data() ?? {}
const depositos = tcfg.depositos ?? {}
const vendedoresCfg = { ...(tcfg.vendedores ?? {}) }
const choferes = (await db.collection('users').where('rol', '==', 'chofer').get()).docs
  .map((d) => ({ uid: d.id, nombre: d.data().nombre ?? d.data().displayName ?? d.id, estado: d.data().estado }))
  .sort((a, b) => a.nombre.localeCompare(b.nombre))

const plan = []
for (const c of choferes) {
  const dep = depositos[c.uid]
  // Mismo criterio para todos (decisión de Ariel 2026-09-05): código = depósito, aunque el
  // chofer ya tuviera otro (Sergio tenía AS; queda en Tango solo para el historial).
  if (!dep) { plan.push({ ...c, codigo: null, accion: 'SIN DEPÓSITO: cargar config/tango.depositos primero' }); continue }
  if (String(dep).length > 2) { plan.push({ ...c, codigo: null, accion: `depósito ${dep} no entra en 2 caracteres` }); continue }
  plan.push({ ...c, codigo: String(dep), nombreTango: nombreTango(c.nombre), accion: vendedoresCfg[c.uid] && vendedoresCfg[c.uid] !== String(dep) ? `crear (reemplaza ${vendedoresCfg[c.uid]} en la config)` : 'crear' })
}

console.log('Plan (código de vendedor = depósito del chofer):')
for (const p of plan) console.log(`  ${p.nombre.padEnd(32)} ${String(p.codigo ?? '-').padEnd(4)} ${p.nombreTango ?? ''}  → ${p.accion}`)
console.log(`  ${'(respaldo)'.padEnd(32)} ${RESPALDO.codigo.padEnd(4)} ${RESPALDO.nombre}  → crear si falta`)

// ── Alta en Tango ────────────────────────────────────────────────────────────
if (COMPANY) {
  const existentes = await vendedoresTango(COMPANY)
  const porCodigo = new Map(existentes.map((v) => [String(v.COD_GVA23).trim(), v]))
  const aCrear = [{ codigo: RESPALDO.codigo, nombre: RESPALDO.nombre }, ...plan.filter((p) => p.codigo && p.nombreTango).map((p) => ({ codigo: p.codigo, nombre: p.nombreTango }))]
  console.log(`\nCompany ${COMPANY}: ${existentes.length} vendedores existentes.`)
  for (const v of aCrear) {
    const ex = porCodigo.get(v.codigo)
    if (ex) {
      const mismo = nombreTango(ex.NOMBRE_VEN) === v.nombre
      console.log(`  ${v.codigo} ya existe como "${ex.NOMBRE_VEN}"${mismo ? '' : '  ← OJO: otro nombre, no se toca'}${ex.INHABILITA ? '  (INHABILITADO)' : ''}`)
      continue
    }
    if (!COMMIT) { console.log(`  ${v.codigo} - ${v.nombre}: se crearía (--commit para crear)`); continue }
    const id = await crearVendedor(COMPANY, v.codigo, v.nombre)
    console.log(`  ${v.codigo} - ${v.nombre}: creado (ID_GVA23 ${id})`)
  }
}

// ── Config de la app ─────────────────────────────────────────────────────────
if (CONFIG) {
  const update = { 'facturador.redonhielo.vendedor': RESPALDO.codigo, 'facturador.rolito.vendedor': RESPALDO.codigo }
  for (const p of plan) if (p.accion.startsWith('crear')) update[`vendedores.${p.uid}`] = p.codigo
  await db.doc('config/tango').set({}, { merge: true })
  await db.doc('config/tango').update(update)
  console.log('\nconfig/tango actualizado:', update)
}
process.exit(0)
