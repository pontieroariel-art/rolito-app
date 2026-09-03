/**
 * sincronizar-choferes-tango.mjs — los choferes de la app tienen que ser
 * EXACTAMENTE los depósitos-repartidor de Tango (decisión de Ariel, 2026-09-03):
 * en Tango cada repartidor es un depósito (STA22: "03 SERGIO ALVAREZ", "04
 * BRIAN GALLO"…) y el pedido/factura que manda la app descarga stock de ese
 * depósito. Este script lee los depósitos por la API (Tango Connect) y deja
 * la app igual:
 *
 *   - depósito con nombre de persona y chofer existente (match por nombre) →
 *     se vincula: users/{uid}.depositoTango + config/tango.depositos[uid].
 *   - depósito con nombre de persona sin chofer → se CREA el chofer (cuenta de
 *     Auth con email deposito-{cod}@rolito.app, sin DNI ni PIN: no puede
 *     entrar hasta que se lo vincule con --vincular COD=CUIT=PIN).
 *   - chofer de la app sin depósito en Tango → se DESACTIVA (estado inactivo),
 *     nunca se borra: conserva ventas y despachos.
 *   - depósitos que no son personas (DON TORCUATO, MERLO, REPARTO FABRICA,
 *     PROMOCION, MERMAS, NOAIN 01…, clientes con depósito propio) se ignoran.
 *
 * Uso:
 *   node scripts/tango/sincronizar-choferes-tango.mjs                 → dry-run (Company 1)
 *   node scripts/tango/sincronizar-choferes-tango.mjs --commit
 *   node scripts/tango/sincronizar-choferes-tango.mjs --company 3
 *   node scripts/tango/sincronizar-choferes-tango.mjs --archivo scripts/tango/tango-tablas/depositos.company1.json
 *   node scripts/tango/sincronizar-choferes-tango.mjs --vincular 03=20360242871=1234 --commit
 *        → le pone CUIT/DNI/PIN al chofer del depósito 03 (dniIndex + password), ya puede entrar
 *
 * Token: env TANGO_TOKEN, o `tangoToken` de scripts/tango/bridge-sync-clientes.config.json.
 */
import { readFileSync, existsSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import { randomBytes } from 'crypto'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')

const args    = process.argv.slice(2)
const COMMIT  = args.includes('--commit')
const arg     = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const COMPANY = arg('--company') ?? '1'
const ARCHIVO = arg('--archivo')
const VINCULAR = args.flatMap((a, i) => (a === '--vincular' ? [args[i + 1]] : []))
const BASE = process.env.TANGO_BASE_URL ?? 'https://001174-003.connect.axoft.com'

if (process.env.FIRESTORE_EMULATOR_HOST) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'rolito-app' })
} else {
  const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(sa) })
}
const db = admin.firestore()
const auth = admin.auth()
const { FieldValue } = admin.firestore

// ── Depósitos de Tango ──────────────────────────────────────────────────────
function token() {
  if (process.env.TANGO_TOKEN) return process.env.TANGO_TOKEN
  const p = path.join(__dirname, 'bridge-sync-clientes.config.json')
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')).tangoToken
  throw new Error('Falta el token: env TANGO_TOKEN o scripts/tango/bridge-sync-clientes.config.json')
}

async function depositosTango() {
  if (ARCHIVO) return JSON.parse(readFileSync(ARCHIVO, 'utf8'))
  const t = token()
  const all = []; let i = 0, pages = 1
  do {
    const r = await fetch(`${BASE}/Api/Get?process=2941&pageSize=500&pageIndex=${i}&view=`, { headers: { ApiAuthorization: t, Company: COMPANY } })
    const j = await r.json()
    if (!j.succeeded) throw new Error(`Tango: ${j.exceptionInfo?.messages?.join('; ') ?? j.message}`)
    all.push(...j.resultData.list); pages = j.resultData.totalPages; i++
  } while (i < pages)
  return all
}

// Vendedores (GVA23, process 952): la factura lleva al chofer logueado como
// vendedor, así que cada chofer necesita también su COD_GVA23. Se emparejan
// por nombre igual que los depósitos; los que no existen se listan para
// darlos de alta en Tango.
async function vendedoresTango() {
  if (ARCHIVO) {
    const p = ARCHIVO.replace(/depositos/, 'vendedores')
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []
  }
  const t = token()
  const all = []; let i = 0, pages = 1
  do {
    const r = await fetch(`${BASE}/Api/Get?process=952&pageSize=500&pageIndex=${i}&view=`, { headers: { ApiAuthorization: t, Company: COMPANY } })
    const j = await r.json()
    if (!j.succeeded) throw new Error(`Tango (vendedores): ${j.exceptionInfo?.messages?.join('; ') ?? j.message}`)
    all.push(...j.resultData.list); pages = j.resultData.totalPages; i++
  } while (i < pages)
  return all.filter((v) => !v.INHABILITA)
}

// Depósitos que NO son repartidores (plantas, cuentas internas, clientes con
// depósito propio, series numeradas de un mismo repartidor).
const NO_PERSONA = [
  /^DON TORCUATO$/, /^MERLO$/, /^REPARTO FABRICA$/, /^CONTROLADOR FISCAL$/, /^PROMOCION$/, /^MERMAS$/, /^DEMO$/,
  /^MAR DEL PLATA$/, /^C&E$/, /^DINARDI/, /^FRIGORIFICO/, /^GRUPO /, /\d/, /^(NOAIN|ORONA|ALMIRON) /,
]
const esPersona = (d) => !d.INHABILITA && !NO_PERSONA.some((re) => re.test((d.NOMBRE_SUC ?? '').trim().toUpperCase()))

// ── Matching por nombre ─────────────────────────────────────────────────────
const palabras = (s) => (s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length > 1)
const titulo = (s) => (s ?? '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())

// Distancia de edición chica para tolerar grafías distintas ("BRAIAN"/"BRIAN").
function lev(a, b) {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 1) return 2
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 1; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m][n]
}
const coincide = (w, lista) => lista.some((x) => x === w || (w.length >= 5 && x.length >= 5 && lev(w, x) <= 1))

function emparejar(depositos, choferes) {
  const pares = []          // { dep, chofer }
  const usados = new Set()
  for (const dep of depositos) {
    const pd = palabras(dep.NOMBRE_SUC)
    const cand = choferes
      .filter((c) => !usados.has(c.id))
      .map((c) => ({ c, score: palabras(c.nombre).filter((w) => coincide(w, pd)).length }))
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
    if (cand.length && (cand.length === 1 || cand[0].score > cand[1].score)) {
      usados.add(cand[0].c.id)
      pares.push({ dep, chofer: cand[0].c })
    } else {
      pares.push({ dep, chofer: null, ambiguo: cand.length > 1 ? cand.map((x) => x.c.nombre) : null })
    }
  }
  const sobrantes = choferes.filter((c) => !usados.has(c.id))
  return { pares, sobrantes }
}

// ── Vinculación CUIT/PIN de un chofer creado desde Tango ────────────────────
async function vincular(spec) {
  const [cod, cuitRaw, pin] = spec.split('=')
  const cuit = (cuitRaw ?? '').replace(/\D/g, '')
  if (!cod || cuit.length !== 11 || !pin) throw new Error(`--vincular espera COD=CUIT(11 dígitos)=PIN, recibí "${spec}"`)
  const dni = cuit.slice(2, 10)
  const snap = await db.collection('users').where('rol', '==', 'chofer').where('depositoTango', '==', cod.padStart(2, '0')).get()
  if (snap.size !== 1) throw new Error(`Hay ${snap.size} choferes con depositoTango=${cod}`)
  const ref = snap.docs[0].ref
  const u = snap.docs[0].data()
  console.log(`  vincular ${cod} ${u.nombre}: CUIT ${cuit}, DNI ${dni}, PIN ****`)
  if (!COMMIT) return
  await auth.updateUser(ref.id, { password: `${pin}__ch` })      // padPin() de choferAuthService
  await ref.update({ cuit, dni, username: cuit })
  await db.collection('dniIndex').doc(dni).set({ email: u.email, cuit })
  console.log('    ✓ ya puede entrar con DNI + PIN')
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Modo: ${COMMIT ? 'COMMIT' : 'DRY-RUN'} · Company ${COMPANY}${ARCHIVO ? ' · archivo ' + ARCHIVO : ' · API en vivo'}`)

  if (VINCULAR.length) { for (const v of VINCULAR) await vincular(v); if (args.length === VINCULAR.length * 2 + (COMMIT ? 1 : 0)) return }

  const depositos = (await depositosTango()).filter(esPersona).sort((a, b) => a.COD_STA22.localeCompare(b.COD_STA22))
  const chSnap = await db.collection('users').where('rol', '==', 'chofer').get()
  const choferes = chSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  console.log(`Depósitos-repartidor en Tango: ${depositos.length} · choferes en la app: ${choferes.length}\n`)

  const { pares, sobrantes } = emparejar(depositos, choferes)
  const tangoCfg = (await db.doc('config/tango').get()).data() ?? {}
  const depositosCfg = { ...(tangoCfg.depositos ?? {}) }
  const camionesCfg  = { ...(tangoCfg.camiones ?? {}) }
  const emailsNuevos = []
  let vinculados = 0, creados = 0, desactivados = 0, ambiguos = 0

  console.log('== Vincular (depósito ↔ chofer existente)')
  for (const p of pares.filter((x) => x.chofer)) {
    const c = p.chofer
    const cambia = c.depositoTango !== p.dep.COD_STA22 || c.estado !== 'activo'
    console.log(`  ${p.dep.COD_STA22} ${p.dep.NOMBRE_SUC.padEnd(24)} ← ${c.nombre.padEnd(30)} ${c.estado}${cambia ? '' : ' (ya estaba)'}`)
    vinculados++
    depositosCfg[c.id] = p.dep.COD_STA22
    camionesCfg[c.id]  = p.dep.NOMBRE_SUC
    if (COMMIT && cambia) await db.doc(`users/${c.id}`).update({ depositoTango: p.dep.COD_STA22, depositoTangoNombre: p.dep.NOMBRE_SUC, estado: 'activo' })
  }

  console.log('\n== Crear (depósito sin chofer en la app)')
  for (const p of pares.filter((x) => !x.chofer)) {
    if (p.ambiguo) { ambiguos++; console.log(`  ?? ${p.dep.COD_STA22} ${p.dep.NOMBRE_SUC}: matchea varios (${p.ambiguo.join(', ')}) — resolver a mano`); continue }
    const email = `deposito-${p.dep.COD_STA22}@rolito.app`
    const nombre = titulo(p.dep.NOMBRE_SUC)
    console.log(`  + ${p.dep.COD_STA22} ${nombre.padEnd(24)} → ${email} (sin DNI/PIN: no entra hasta --vincular)`)
    creados++
    if (!COMMIT) continue
    let uid
    try {
      uid = (await auth.createUser({ email, password: randomBytes(24).toString('hex'), displayName: nombre })).uid
    } catch (e) {
      if (e.code !== 'auth/email-already-exists') throw e
      uid = (await auth.getUserByEmail(email)).uid
    }
    await db.doc(`users/${uid}`).set({
      nombre, nombreContacto: nombre, email, rol: 'chofer', estado: 'activo',
      cuit: '', dni: null, phone: '', address: '',
      depositoTango: p.dep.COD_STA22, depositoTangoNombre: p.dep.NOMBRE_SUC,
      fechaCreacion: FieldValue.serverTimestamp(), aprobadoPor: 'sync-tango-depositos',
    }, { merge: true })
    depositosCfg[uid] = p.dep.COD_STA22
    camionesCfg[uid]  = p.dep.NOMBRE_SUC
    emailsNuevos.push(email)
  }

  console.log('\n== Desactivar (chofer sin depósito en Tango)')
  for (const c of sobrantes) {
    console.log(`  - ${c.nombre.padEnd(30)} ${c.estado}${c.estado === 'inactivo' ? ' (ya estaba)' : ' → inactivo'}`)
    if (c.estado !== 'inactivo') desactivados++
    if (COMMIT && c.estado !== 'inactivo') await db.doc(`users/${c.id}`).update({ estado: 'inactivo', desactivadoPor: 'sync-tango-depositos', desactivadoEl: FieldValue.serverTimestamp() })
  }

  // Vendedor por chofer (COD_GVA23), emparejado por nombre contra los vendedores de Tango.
  console.log('\n== Vendedor de Tango por chofer (la factura lleva al chofer como vendedor)')
  const vendedores = await vendedoresTango()
  const vendedoresCfg = { ...(tangoCfg.vendedores ?? {}) }
  const sinVendedor = []
  const choferesFinal = pares.filter((x) => x.chofer).map((x) => ({ id: x.chofer.id, nombre: x.dep.NOMBRE_SUC }))
  for (const p of pares.filter((x) => !x.chofer && !x.ambiguo)) choferesFinal.push({ id: null, nombre: p.dep.NOMBRE_SUC, cod: p.dep.COD_STA22 })
  for (const c of choferesFinal) {
    const pn = palabras(c.nombre)
    const cand = vendedores
      .map((v) => ({ v, score: palabras(v.NOMBRE_VEN).filter((w) => coincide(w, pn)).length }))
      .filter((x) => x.score >= 2).sort((a, b) => b.score - a.score)
    const uid = c.id ?? Object.entries(depositosCfg).find(([, cod]) => cod === c.cod)?.[0]
    if (cand.length && (cand.length === 1 || cand[0].score > cand[1].score)) {
      console.log(`  ${c.nombre.padEnd(24)} → vendedor ${String(cand[0].v.COD_GVA23).padEnd(4)} ${cand[0].v.NOMBRE_VEN}`)
      if (uid) vendedoresCfg[uid] = String(cand[0].v.COD_GVA23)
    } else {
      sinVendedor.push(c.nombre)
      console.log(`  ${c.nombre.padEnd(24)} → (no existe como vendedor en Tango: darlo de alta)`)
    }
  }

  if (COMMIT) {
    await db.doc('config/tango').set({ depositos: depositosCfg, camiones: camionesCfg, vendedores: vendedoresCfg }, { merge: true })
    if (emailsNuevos.length) await db.doc('config/choferes').set({ emails: FieldValue.arrayUnion(...emailsNuevos) }, { merge: true })
  }

  console.log(`\nResumen: ${vinculados} vinculados · ${creados} a crear · ${desactivados} a desactivar · ${ambiguos} ambiguos · ${sinVendedor.length} sin vendedor en Tango${sinVendedor.length ? ` (${sinVendedor.join(', ')})` : ''}`)
  if (!COMMIT) console.log('DRY-RUN — no se escribió nada. Corré con --commit para aplicar.')
}

// Sin process.exit(): en Windows la salida a una tubería es asíncrona y se perdería.
main().catch((e) => { console.error('Error fatal:', e.message); process.exitCode = 1 }).finally(() => admin.app().delete())
