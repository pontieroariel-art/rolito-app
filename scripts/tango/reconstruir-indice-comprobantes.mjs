/**
 * reconstruir-indice-comprobantes.mjs — repone en `tangoComprobantes/{empresa}_{codigo}` las
 * entradas de facturas y remitos que se borraron, a partir de los detalles que SÍ quedaron en
 * `tangoComprobanteDetalle` (2026-09-15).
 *
 * Por qué: hasta el 2026-09-15 el lector (comprobantes-sync.mjs) escribía el índice con
 * `set({ facturas: {}, remitos: {…} }, { merge: true })` cuando a un cliente solo le había
 * cambiado un remito, y con merge un mapa vacío reemplaza al mapa entero: 179 clientes
 * quedaron sin facturas en el índice (la pestaña "Todas (12 meses)" vacía y las facturas sin
 * su remito). Los detalles nunca se tocaron, así que el índice se rearma desde ahí.
 *
 * Qué hace: para cada índice compara las claves que tiene con las de sus detalles de los
 * últimos 13 meses (MESES_HISTORIAL) y agrega SOLO las que faltan, con la misma forma que
 * escribe el lector (huella incluida). No borra ni pisa nada de lo que ya está. Si hay
 * detalles de un cliente sin índice, lo crea.
 *
 * Uso (desde la raíz del repo, con scripts/serviceAccount.json):
 *   node scripts/tango/reconstruir-indice-comprobantes.mjs                 → dry-run: muestra qué haría
 *   node scripts/tango/reconstruir-indice-comprobantes.mjs --aplicar       → escribe
 *   node scripts/tango/reconstruir-indice-comprobantes.mjs --codigo OR.116 → solo ese código (con o sin --aplicar)
 *   node scripts/tango/reconstruir-indice-comprobantes.mjs --empresa rolito
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import { MESES_HISTORIAL, claveFactura, huella, iso, restarMeses, seccionesIndice } from './comprobantes-tango.mjs'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../lib/firebase-admin-compat.cjs')
const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

const args = process.argv.slice(2)
const aplicar = args.includes('--aplicar')
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const soloCodigo = arg('--codigo')?.trim().toUpperCase() ?? null
const soloEmpresa = arg('--empresa') ?? null

const limite = iso(restarMeses(new Date(), MESES_HISTORIAL))
console.log(`Reconstrucción del índice de comprobantes — ${aplicar ? 'MODO REAL' : 'DRY-RUN (no escribe)'}; historial desde ${limite}${soloEmpresa ? `, empresa ${soloEmpresa}` : ''}${soloCodigo ? `, código ${soloCodigo}` : ''}\n`)

// ── 1. Índices ──
let qIdx = db.collection('tangoComprobantes')
if (soloEmpresa) qIdx = qIdx.where('empresa', '==', soloEmpresa)
if (soloCodigo) qIdx = qIdx.where('codigo', '==', soloCodigo)
const indices = new Map((await qIdx.get()).docs.map((d) => [d.id, d.data()]))
console.log(`índices leídos: ${indices.size}`)

// ── 2. Detalles proyectados (sin renglones ni cliente: solo lo que va en la entrada del índice) ──
let qDet = db.collection('tangoComprobanteDetalle').select('empresa', 'codigo', 'tipo', 'familia', 'numero', 'fecha', 'estado', 'bultos', 'remitos', 'facturas', 'totales', 'cliente')
if (soloEmpresa) qDet = qDet.where('empresa', '==', soloEmpresa)
if (soloCodigo) qDet = qDet.where('codigo', '==', soloCodigo)
const porIndice = new Map()   // `${empresa}_${codigo}` → [{ id, ...proyección }]
let nDet = 0, fueraDeVentana = 0
for (const d of (await qDet.get()).docs) {
  const x = d.data()
  nDet++
  if (!x.fecha || x.fecha < limite) { fueraDeVentana++; continue }
  const k = `${x.empresa}_${x.codigo}`
  if (!porIndice.has(k)) porIndice.set(k, [])
  porIndice.get(k).push({ id: d.id, ...x })
}
console.log(`detalles leídos: ${nDet} (${fueraDeVentana} anteriores a ${limite}, se ignoran)\n`)

// ── 3. Qué le falta a cada índice ──
const faltantes = []   // { id, empresa, codigo, nuevo, facturas: [det], remitos: [det] }
let sinFaltas = 0
for (const [id, dets] of porIndice) {
  const idx = indices.get(id)
  const facturasIdx = idx?.facturas ?? {}
  const remitosIdx = idx?.remitos ?? {}
  const facturas = dets.filter((d) => d.tipo !== 'REM' && !facturasIdx[claveFactura(d.tipo, d.numero)])
  const remitos = dets.filter((d) => d.tipo === 'REM' && !remitosIdx[String(d.numero).trim().toUpperCase()])
  if (!facturas.length && !remitos.length) { sinFaltas++; continue }
  faltantes.push({ id, empresa: dets[0].empresa, codigo: dets[0].codigo, nuevo: !idx, facturas, remitos })
}
faltantes.sort((a, b) => (b.facturas.length + b.remitos.length) - (a.facturas.length + a.remitos.length))

const totF = faltantes.reduce((s, f) => s + f.facturas.length, 0)
const totR = faltantes.reduce((s, f) => s + f.remitos.length, 0)
console.log(`clientes completos: ${sinFaltas} · a reparar: ${faltantes.length} (${faltantes.filter((f) => f.nuevo).length} sin índice) · entradas a reponer: ${totF} facturas/NC/ND/recibos + ${totR} remitos\n`)
for (const f of faltantes.slice(0, 25)) console.log(`  ${f.id.padEnd(22)} ${f.nuevo ? '(índice nuevo) ' : ''}+${f.facturas.length} facturas, +${f.remitos.length} remitos`)
if (faltantes.length > 25) console.log(`  … y ${faltantes.length - 25} más`)

if (!aplicar) { console.log('\nDry-run: nada escrito. Correr con --aplicar para grabar.'); process.exit(0) }
if (!faltantes.length) { console.log('\nNada que reparar.'); process.exit(0) }

// ── 4. Huella: se calcula sobre el detalle completo, igual que el lector (menos actualizadoEn) ──
async function huellasDe(ids) {
  const out = new Map()
  for (let i = 0; i < ids.length; i += 200) {
    const refs = ids.slice(i, i + 200).map((id) => db.collection('tangoComprobanteDetalle').doc(id))
    for (const s of await db.getAll(...refs)) {
      if (!s.exists) continue
      const { actualizadoEn: _a, ...detalle } = s.data()
      out.set(s.id, huella(detalle))
    }
  }
  return out
}

const entradaFactura = (d, h) => ({
  tipo: d.tipo, familia: d.familia ?? 'otro', numero: d.numero, fecha: d.fecha, importe: Number(d.totales?.total ?? 0), estado: d.estado ?? '',
  ...(Array.isArray(d.remitos) && d.remitos.length ? { remitos: d.remitos } : {}),
  h,
})
const entradaRemito = (d, h) => ({
  fecha: d.fecha, estado: d.estado ?? '', bultos: Number(d.bultos ?? 0),
  ...(Array.isArray(d.facturas) && d.facturas.length ? { facturas: d.facturas } : {}),
  h,
})

// ── 5. Escritura: un set con merge por cliente, SOLO con las secciones que traen algo ──
const LOTE = 150
let escritos = 0, entradas = 0
for (let i = 0; i < faltantes.length; i += LOTE) {
  const tanda = faltantes.slice(i, i + LOTE)
  const huellas = await huellasDe(tanda.flatMap((f) => [...f.facturas, ...f.remitos].map((d) => d.id)))
  const b = db.batch()
  for (const f of tanda) {
    const cambios = { facturas: {}, remitos: {} }
    for (const d of f.facturas) cambios.facturas[claveFactura(d.tipo, d.numero)] = entradaFactura(d, huellas.get(d.id) ?? '')
    for (const d of f.remitos) cambios.remitos[String(d.numero).trim().toUpperCase()] = entradaRemito(d, huellas.get(d.id) ?? '')
    const secciones = seccionesIndice(cambios, undefined, () => admin.firestore.FieldValue.delete())
    const base = f.nuevo
      ? { empresa: f.empresa, codigo: f.codigo, razonSocial: String([...f.facturas, ...f.remitos][0]?.cliente?.razonSocial ?? '').trim(), email: '' }
      : {}
    b.set(db.collection('tangoComprobantes').doc(f.id), { ...base, ...secciones, reconstruidoEn: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    entradas += f.facturas.length + f.remitos.length
  }
  await b.commit()
  escritos += tanda.length
  console.log(`  escritos ${escritos}/${faltantes.length} índices (${entradas} entradas)`)
}
console.log(`\nListo: ${escritos} índices reparados, ${entradas} entradas repuestas.`)
