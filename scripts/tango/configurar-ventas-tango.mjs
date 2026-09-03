/**
 * configurar-ventas-tango.mjs — deja lista la config que necesita el writer
 * de remitos del bridge (enviarRemitoATango) en `config/tango`, y muestra qué
 * falta. Corre contra PRODUCCIÓN (serviceAccount.json) salvo que se exporte
 * FIRESTORE_EMULATOR_HOST.
 *
 *   node scripts/tango/configurar-ventas-tango.mjs                      → muestra estado y faltantes
 *   node scripts/tango/configurar-ventas-tango.mjs --companies 4 4      → redonhielo=4 rolito=4 (TestingRH)
 *   node scripts/tango/configurar-ventas-tango.mjs --articulo bolsa_10kg=HB10 --articulo barra=BARRA
 *   node scripts/tango/configurar-ventas-tango.mjs --deposito AF313WU=05  (patente o id del camión = COD_STA22)
 *   node scripts/tango/configurar-ventas-tango.mjs --pedido talonarioId=7 --pedido estado=2
 *   node scripts/tango/configurar-ventas-tango.mjs --remitos on|off      → config/tango.remitosEnabled
 *   node scripts/tango/configurar-ventas-tango.mjs --numeracion remito=2 --numeracion remitoPromo=3 --numeracion facturaX=3
 *        → crea config/numeracionInterna_<tipo> = { next: 1, puntoVenta } SOLO si no existe
 *
 * Las claves que escribe son las que lee el bridge (docs/tango/INTEGRACION.md §14):
 *   companies { redonhielo, rolito }   articulos { productoId: COD_STA11 }
 *   depositos { camionId: COD_STA22 }  camiones { camionId: patente }   pedido { talonarioId, estado, comprometeStock, ... }
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')

if (process.env.FIRESTORE_EMULATOR_HOST) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'rolito-app' })
} else {
  const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(sa) })
}
const db = admin.firestore()

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const tomar = (flag) => { const out = []; for (let i = 0; i < args.length; i++) if (args[i] === flag) out.push(args[++i]); return out }
const kv = (s) => { const i = s.indexOf('='); if (i < 0) throw new Error(`Esperaba clave=valor, recibí "${s}"`); return [s.slice(0, i), s.slice(i + 1)] }
const num = (v) => (/^-?\d+$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v)

const flota = await db.collection('flota').get()
const camiones = flota.docs.map((d) => ({ id: d.id, patente: d.data().patente, activo: d.data().activo }))
const catalogo = (await db.doc('config/catalogo').get()).data()?.productos ?? []

const update = {}
const [c1, c2] = tomar('--companies')
if (c1 !== undefined) {
  if (c2 === undefined) throw new Error('--companies necesita dos números: redonhielo rolito')
  update.companies = { redonhielo: Number(c1), rolito: Number(c2) }
}
for (const a of tomar('--articulo')) { const [k, v] = kv(a); (update.articulos ??= {})[k] = v }
for (const d of tomar('--deposito')) {
  const [k, v] = kv(d)
  const cam = camiones.find((c) => c.id === k || c.patente?.toUpperCase() === k.toUpperCase())
  if (!cam) throw new Error(`No hay camión con id/patente "${k}" en flota`)
  ;(update.depositos ??= {})[cam.id] = v
  ;(update.camiones ??= {})[cam.id] = cam.patente
}
// --deposito-chofer <uid o apellido>=COD_STA22 — en Tango los depósitos son por
// repartidor (03 SERGIO ALVAREZ…), así que el mapeo principal es por chofer.
const choferesSnap = await db.collection('users').where('rol', '==', 'chofer').get()
const choferes = choferesSnap.docs.map((d) => ({ id: d.id, nombre: d.data().nombre ?? '', estado: d.data().estado }))
for (const d of tomar('--deposito-chofer')) {
  const [k, v] = kv(d)
  const cands = choferes.filter((c) => c.id === k || c.nombre.toUpperCase().includes(k.toUpperCase()))
  if (cands.length !== 1) throw new Error(`"${k}" matchea ${cands.length} choferes (${cands.map((c) => c.nombre).join(', ') || 'ninguno'}): usá el uid`)
  ;(update.depositos ??= {})[cands[0].id] = v
  ;(update.camiones ??= {})[cands[0].id] = cands[0].nombre
}
for (const p of tomar('--pedido')) { const [k, v] = kv(p); (update.pedido ??= {})[k] = num(v) }
const [remitos] = tomar('--remitos')
if (remitos) update.remitosEnabled = remitos === 'on'
const [facturas] = tomar('--facturas')
if (facturas) update.facturasEnabled = facturas === 'on'
// --facturador redonhielo talonarios.A=20 --facturador redonhielo cuentas.contado_efectivo=1 ...
// (clave con puntos = anidado; el valor numérico se guarda como número)
{
  const fac = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--facturador') continue
    const empresa = args[++i]; const par = args[++i]
    if (!['redonhielo', 'rolito'].includes(empresa) || !par) throw new Error('Uso: --facturador <redonhielo|rolito> clave=valor')
    const [k, v] = kv(par)
    let nodo = (fac[empresa] ??= {})
    const partes = k.split('.')
    for (const p of partes.slice(0, -1)) nodo = (nodo[p] ??= {})
    nodo[partes.at(-1)] = num(v)
  }
  if (Object.keys(fac).length) update.facturador = fac
}

if (Object.keys(update).length) {
  await db.doc('config/tango').set(update, { merge: true })
  console.log('config/tango actualizado:', JSON.stringify(update))
}

for (const n of tomar('--numeracion')) {
  const [tipo, pv] = kv(n)
  if (!['remito', 'remitoPromo', 'facturaX'].includes(tipo)) throw new Error(`tipo de numeración inválido: ${tipo}`)
  const ref = db.doc(`config/numeracionInterna_${tipo}`)
  const snap = await ref.get()
  if (snap.exists) { console.log(`config/numeracionInterna_${tipo} ya existe (next ${snap.data().next}, pto vta ${snap.data().puntoVenta}) — no se toca`); continue }
  await ref.set({ next: 1, puntoVenta: Number(pv), creadoEl: admin.firestore.FieldValue.serverTimestamp() })
  console.log(`config/numeracionInterna_${tipo} creado: next 1, puntoVenta ${pv}`)
}

// ── estado ──────────────────────────────────────────────────────────────────
const tango = (await db.doc('config/tango').get()).data() ?? {}
const faltas = []
console.log('\n== config/tango')
console.log('  enabled:', tango.enabled === true, '| remitosEnabled:', tango.remitosEnabled === true, '| bridge visto:', tango.bridgeListenerLastSeen?.toDate?.().toISOString() ?? 'nunca')
console.log('  companies:', JSON.stringify(tango.companies ?? null))
if (!Number.isInteger(tango.companies?.redonhielo) || !Number.isInteger(tango.companies?.rolito)) faltas.push('companies (--companies N N)')
console.log('  pedido:', JSON.stringify(tango.pedido ?? {}))

console.log('\n== facturador (config/tango.facturador.<empresa>) — facturasEnabled:', tango.facturasEnabled === true)
for (const empresa of ['redonhielo', 'rolito']) {
  const f = tango.facturador?.[empresa]
  if (!f) { console.log(`  ✗ ${empresa}: sin configurar`); faltas.push(`facturador.${empresa}`); continue }
  const req = ['condicionVenta', 'listaPrecio', 'contracuenta', 'vendedor', 'codigoTasaIva21']
  const faltan = req.filter((k) => f[k] === undefined || f[k] === null || f[k] === '')
  if (!f.talonarios || !Object.keys(f.talonarios).length) faltan.push('talonarios')
  if (!f.cuentas?.contado_efectivo) faltan.push('cuentas.contado_efectivo')
  if (!f.cuentas?.contado_transferencia) faltan.push('cuentas.contado_transferencia')
  if (empresa === 'redonhielo' && !f.codigoAlicuotaPercepcionIIBB) faltan.push('codigoAlicuotaPercepcionIIBB')
  console.log(`  ${faltan.length ? '✗' : '✓'} ${empresa}: ${JSON.stringify(f)}${faltan.length ? `\n      faltan: ${faltan.join(', ')}` : ''}`)
  if (faltan.length) faltas.push(`facturador.${empresa} (${faltan.join(', ')})`)
}

console.log('\n== artículos (productoId → COD_STA11)')
for (const p of catalogo) {
  const cod = tango.articulos?.[p.id]
  console.log(`  ${cod ? '✓' : '✗'} ${p.id.padEnd(45)} ${p.nombre.padEnd(36)} ${cod ?? '(falta)'}`)
  if (!cod) faltas.push(`artículo ${p.id}`)
}

console.log('\n== choferes activos (uid / nombre → COD_STA22 del depósito-repartidor)')
for (const c of choferes.filter((c) => c.estado === 'activo')) {
  const cod = tango.depositos?.[c.id]
  console.log(`  ${cod ? '✓' : '✗'} ${c.nombre.padEnd(30)} ${c.id}  ${cod ?? '(falta)'}`)
  if (!cod) faltas.push(`depósito de ${c.nombre}`)
}
const camionesConDeposito = camiones.filter((c) => tango.depositos?.[c.id])
if (camionesConDeposito.length) console.log('  (por camión, fallback):', camionesConDeposito.map((c) => `${c.patente}=${tango.depositos[c.id]}`).join(', '))

console.log('\n== numeración interna')
for (const tipo of ['remito', 'remitoPromo', 'facturaX']) {
  const s = await db.doc(`config/numeracionInterna_${tipo}`).get()
  console.log(`  ${s.exists ? '✓' : '✗'} ${tipo.padEnd(12)} ${s.exists ? `next ${s.data().next}, pto vta ${s.data().puntoVenta}` : '(no existe → las ventas salen SIN NÚMERO)'}`)
  if (!s.exists) faltas.push(`numeración ${tipo}`)
}

const outbox = await db.collection('tango-outbox').where('entidad', '==', 'remito').get()
const porEstado = {}
outbox.forEach((d) => { porEstado[d.data().estado] = (porEstado[d.data().estado] ?? 0) + 1 })
console.log('\n== tango-outbox (remitos):', JSON.stringify(porEstado))
outbox.forEach((d) => { const x = d.data(); if (x.ultimoError) console.log(`  ${d.id}: ${x.estado} — ${x.ultimoError}`) })

console.log(faltas.length ? `\nFALTA: ${faltas.join(' · ')}` : '\nTodo configurado.')
process.exit(0)
