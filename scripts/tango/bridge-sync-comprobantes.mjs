/**
 * bridge-sync-comprobantes.mjs — facturas y remitos de Tango → Firestore (SOLO LEE SQL).
 *
 * Corre EN EL SERVIDOR DE TANGO (RHIELOTG), en la misma carpeta que bridge-sql.mjs y con
 * su misma config (bridge-sql.config.json: login `tango-bridge` de Firebase + login SQL
 * `rolito_bridge`, que tiene db_datareader). Programado en el Task Scheduler cada hora.
 *
 * Qué publica (docs/tango/INTEGRACION.md §35):
 *   tangoComprobantes/{empresa}_{codigo}          índice liviano por código de cliente:
 *                                                 facturas/NC/ND y remitos de los últimos
 *                                                 13 meses, con estado y cruce factura ↔ remito
 *   tangoComprobanteDetalle/{empresa}_{tipo}_{n}   detalle para regenerar el PDF en la app
 *                                                 (renglones, CAE, cliente, talonario/CAI)
 *
 * Fuente (relevado 2026-09-09, scripts/tango/sql/11..15): GVA12 + GVA53 (facturas y
 * renglones, CAICAE/CAICAE_VTO), STA14 + STA20 (remitos), GVA54 (renglón de factura ↔
 * renglón de remito, por TCOMP_IN_S + NCOMP_IN_S), GVA43 (talonarios: CAI del remito),
 * GVA01 (condiciones de venta), GVA23 (vendedores), GVA14 (clientes), STA11 (artículos).
 *
 * Cada corrida trae los últimos `diasVentana` (45) días y escribe SOLO lo nuevo o
 * cambiado (huella por comprobante, cache local comprobantes-cache.{empresa}.json).
 * Una entrada más vieja que 13 meses se saca del índice (el detalle queda).
 *
 * Uso:
 *   node bridge-sync-comprobantes.mjs --dry-run                 no escribe nada; muestra qué haría
 *   node bridge-sync-comprobantes.mjs --backfill                primera carga: 400 días hacia atrás
 *   node bridge-sync-comprobantes.mjs --empresa=redonhielo      una sola empresa
 *   node bridge-sync-comprobantes.mjs --cliente=PA.003          un solo código (para probar)
 *   node bridge-sync-comprobantes.mjs                           corrida normal (ventana de 45 días)
 *
 * Config opcional en bridge-sql.config.json:
 *   "comprobantes": { "diasVentana": 45, "diasBackfill": 400, "logFile": "C:\\RolitoSync\\sql\\bridge-sync-comprobantes.log" }
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { createRequire } from 'module'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, doc, writeBatch, serverTimestamp, deleteField } from 'firebase/firestore'
import {
  MESES_HISTORIAL, aPodar, actualizarCache, diferencias, iso, mapearFacturas, mapearRemitos, relacionDeFilas,
  restarDias, restarMeses,
} from './comprobantes-tango.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const mssql = require('mssql')

const DRY_RUN = process.argv.includes('--dry-run')
const BACKFILL = process.argv.includes('--backfill')
const arg = (nombre) => { const a = process.argv.find((x) => x.startsWith(`--${nombre}=`)); return a ? a.slice(nombre.length + 3) : null }
const SOLO_EMPRESA = arg('empresa')
const SOLO_CLIENTE = arg('cliente')?.trim().toUpperCase() ?? null

const CONFIG_PATH = path.join(__dirname, 'bridge-sql.config.json')
const cfg = (() => {
  const texto = readFileSync(CONFIG_PATH, 'utf8')
  return JSON.parse(texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto)
})()
const opciones = { diasVentana: 45, diasBackfill: 400, ...(cfg.comprobantes ?? {}) }
const LOG_FILE = opciones.logFile ?? path.join(path.dirname(cfg.logFile ?? path.join(__dirname, 'x.log')), 'bridge-sync-comprobantes.log')

function log(linea) {
  const conFecha = `[${new Date().toISOString()}] ${linea}`
  console.log(conFecha)
  try { appendFileSync(LOG_FILE, conFecha + '\n', 'utf8') } catch { /* best effort */ }
}

// ── SQL ──────────────────────────────────────────────────────────────────────
const pools = new Map()
async function pool(database) {
  if (!pools.has(database)) {
    const p = new mssql.ConnectionPool({
      server: cfg.sql.server, database, user: cfg.sql.user, password: cfg.sql.password, port: cfg.sql.port ?? 1433,
      options: { encrypt: cfg.sql.encrypt ?? false, trustServerCertificate: true, enableArithAbort: true, useUTC: false },
      pool: { max: 2, min: 0, idleTimeoutMillis: 30000 },
      requestTimeout: 10 * 60 * 1000,
    })
    await p.connect()
    pools.set(database, p)
  }
  return pools.get(database)
}
async function consulta(p, sql, params = {}) {
  const req = new mssql.Request(p)
  for (const [k, v] of Object.entries(params)) req.input(k, v instanceof Date ? mssql.DateTime : mssql.VarChar(50), v)
  return (await req.query(sql)).recordset ?? []
}

/** Columnas que existen en una tabla (para pedir solo las que hay: el esquema cambia entre versiones). */
async function columnasDe(p, tabla) {
  const filas = await consulta(p, `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(@t)`, { t: tabla })
  return new Set(filas.map((f) => f.name))
}
const filtroCliente = (col) => (SOLO_CLIENTE ? ` AND ${col} = @cliente` : '')

async function leerEmpresa(empresa, database, desde) {
  const p = await pool(database)
  const params = { desde, ...(SOLO_CLIENTE ? { cliente: SOLO_CLIENTE } : {}) }
  const t0 = Date.now()

  const facturas = await consulta(p, `
    SELECT ID_GVA12, T_COMP, N_COMP, FECHA_EMIS, IMPORTE, IMPORTE_GR, IMPORTE_EX, IMPORTE_IV, IMPORTE_IN, ESTADO, COD_CLIENT,
           CAT_IVA, COND_VTA, COD_VENDED, CAICAE, CAICAE_VTO, FECHA_ANU
    FROM GVA12 WHERE T_COMP IN ('FAC','N/C','N/D') AND FECHA_EMIS >= @desde${filtroCliente('COD_CLIENT')}`, params)
  const renglonesFac = await consulta(p, `
    SELECT r.T_COMP, r.N_COMP, r.N_RENGL_V, r.COD_ARTICU, a.DESCRIPCIO, r.CANTIDAD, r.PRECIO_NET, r.PORC_DTO, r.PORC_IVA, r.IMP_NETO_P
    FROM GVA53 r JOIN GVA12 f ON f.T_COMP = r.T_COMP AND f.N_COMP = r.N_COMP LEFT JOIN STA11 a ON a.COD_ARTICU = r.COD_ARTICU
    WHERE f.T_COMP IN ('FAC','N/C','N/D') AND f.FECHA_EMIS >= @desde${filtroCliente('f.COD_CLIENT')}`, params)
  const remitos = await consulta(p, `
    SELECT ID_STA14, N_COMP, FECHA_MOV, ESTADO_MOV, COD_PRO_CL, TALONARIO, USUARIO, FECHA_ANU
    FROM STA14 WHERE T_COMP = 'REM' AND FECHA_MOV >= @desde${filtroCliente('COD_PRO_CL')}`, params)
  const renglonesRem = await consulta(p, `
    SELECT r.ID_STA14, r.N_RENGL_S, r.COD_ARTICU, a.DESCRIPCIO, r.CANTIDAD
    FROM STA20 r JOIN STA14 s ON s.ID_STA14 = r.ID_STA14 LEFT JOIN STA11 a ON a.COD_ARTICU = r.COD_ARTICU
    WHERE s.T_COMP = 'REM' AND s.FECHA_MOV >= @desde${filtroCliente('s.COD_PRO_CL')}`, params)
  // Relación por las dos puntas: facturas de la ventana (con remitos de cualquier fecha) y
  // remitos de la ventana (con facturas de cualquier fecha).
  const relacion = await consulta(p, `
    SELECT g.T_COMP_V, g.N_COMP, s.N_COMP AS REMITO
    FROM GVA54 g JOIN GVA12 f ON f.T_COMP = g.T_COMP_V AND f.N_COMP = g.N_COMP
    JOIN STA14 s ON s.TCOMP_IN_S = g.TCOMP_IN_S AND s.NCOMP_IN_S = g.NCOMP_IN_S
    WHERE (f.FECHA_EMIS >= @desde OR s.FECHA_MOV >= @desde)${filtroCliente('f.COD_CLIENT')}
    GROUP BY g.T_COMP_V, g.N_COMP, s.N_COMP`, params)
  const talonarios = Object.fromEntries((await consulta(p, `SELECT TALONARIO, CAI, FECHA_VTO, DESCRIP FROM GVA43 WHERE COMPROB = 'REM'`)).map((t) => [String(Number(t.TALONARIO)), t]))
  const condiciones = Object.fromEntries((await consulta(p, `SELECT COND_VTA, DESC_COND FROM GVA01`)).map((c) => [String(c.COND_VTA), String(c.DESC_COND ?? '').trim()]))
  const vendedores = Object.fromEntries((await consulta(p, `SELECT COD_GVA23, NOMBRE_VEN FROM GVA23`)).map((v) => [String(v.COD_GVA23 ?? '').trim(), String(v.NOMBRE_VEN ?? '').trim()]))

  const colsCliente = await columnasDe(p, 'GVA14')
  const pedir = ['COD_GVA14', 'RAZON_SOCI', 'CUIT', 'DOMICILIO', 'LOCALIDAD', 'C_POSTAL', 'COD_PROVIN', 'CAT_IVA', 'IVA'].filter((c) => colsCliente.has(c))
  const clientes = Object.fromEntries((await consulta(p, `SELECT ${pedir.join(', ')} FROM GVA14`)).map((c) => [String(c.COD_GVA14 ?? '').trim(), c]))

  log(`  ${empresa}: ${facturas.length} facturas (${renglonesFac.length} renglones), ${remitos.length} remitos (${renglonesRem.length} renglones), ${relacion.length} cruces, ${Object.keys(clientes).length} clientes — ${((Date.now() - t0) / 1000).toFixed(1)} s`)

  const { porFactura, porRemito } = relacionDeFilas(relacion)
  const f = mapearFacturas({ empresa, facturas, renglones: renglonesFac, remitosPorFactura: porFactura, clientes, condiciones, vendedores })
  const r = mapearRemitos({ empresa, remitos, renglones: renglonesRem, facturasPorRemito: porRemito, talonarios, clientes, condiciones })
  return { resumenFacturas: f.resumen, resumenRemitos: r.resumen, detalles: [...f.detalles, ...r.detalles], clientes }
}

// ── Cache local ──────────────────────────────────────────────────────────────
const rutaCache = (empresa) => path.join(__dirname, `comprobantes-cache.${empresa}.json`)
function leerCache(empresa) {
  try { return existsSync(rutaCache(empresa)) ? JSON.parse(readFileSync(rutaCache(empresa), 'utf8')) : {} } catch { return {} }
}

// ── Firestore ────────────────────────────────────────────────────────────────
const LOTE = 400
async function escribir(db, empresa, porCodigo, podados, detalles, clientes, desdeIso) {
  const ops = []
  for (const d of detalles) ops.push((b) => b.set(doc(db, 'tangoComprobanteDetalle', d.id), { ...d.doc, actualizadoEn: serverTimestamp() }))
  const codigos = new Set([...Object.keys(porCodigo), ...Object.keys(podados)])
  for (const codigo of codigos) {
    const cambios = porCodigo[codigo] ?? { facturas: {}, remitos: {} }
    const poda = podados[codigo] ?? { facturas: [], remitos: [] }
    const facturas = { ...cambios.facturas }
    const remitos = { ...cambios.remitos }
    for (const k of poda.facturas) facturas[k] = deleteField()
    for (const k of poda.remitos) remitos[k] = deleteField()
    const datos = {
      empresa, codigo,
      razonSocial: String(clientes[codigo]?.RAZON_SOCI ?? '').trim(),
      desde: desdeIso,
      actualizadoEn: serverTimestamp(),
      facturas, remitos,
    }
    ops.push((b) => b.set(doc(db, 'tangoComprobantes', `${empresa}_${codigo}`), datos, { merge: true }))
  }
  for (let i = 0; i < ops.length; i += LOTE) {
    const b = writeBatch(db)
    for (const op of ops.slice(i, i + LOTE)) op(b)
    await b.commit()
    log(`  escritos ${Math.min(i + LOTE, ops.length)}/${ops.length}`)
  }
  return ops.length
}

async function main() {
  const empresas = Object.entries(cfg.sql.bases ?? {}).filter(([e]) => !SOLO_EMPRESA || e === SOLO_EMPRESA)
  if (!empresas.length) { log(`Sin empresas para procesar (--empresa=${SOLO_EMPRESA ?? ''}).`); process.exit(1) }
  const hoy = new Date()
  const desde = restarDias(hoy, BACKFILL ? opciones.diasBackfill : opciones.diasVentana)
  const limitePoda = iso(restarMeses(hoy, MESES_HISTORIAL))
  log(`Comprobantes de Tango → app: ${DRY_RUN ? 'DRY-RUN (no escribe)' : 'modo real'}${BACKFILL ? ', BACKFILL' : ''}, desde ${iso(desde)}${SOLO_CLIENTE ? `, solo ${SOLO_CLIENTE}` : ''}`)

  let db = null
  if (!DRY_RUN) {
    const app = initializeApp(cfg.firebaseConfig)
    await signInWithEmailAndPassword(getAuth(app), cfg.tangoBridgeEmail, cfg.tangoBridgePassword)
    db = getFirestore(app)
    log('Sesión de Firebase OK (tango-bridge).')
  }

  let fallas = 0
  for (const [empresa, database] of empresas) {
    try {
      log(`${empresa} (base ${database}):`)
      const { resumenFacturas, resumenRemitos, detalles, clientes } = await leerEmpresa(empresa, database, desde)
      const cache = SOLO_CLIENTE ? {} : leerCache(empresa)
      const { porCodigo, detallesAEscribir } = diferencias(cache, resumenFacturas, resumenRemitos, detalles)
      const podados = SOLO_CLIENTE ? {} : aPodar(cache, limitePoda)
      const nCodigos = Object.keys(porCodigo).length
      const nPoda = Object.values(podados).reduce((s, x) => s + x.facturas.length + x.remitos.length, 0)
      log(`  cambios: ${nCodigos} códigos de cliente, ${detallesAEscribir.length} detalles; a podar: ${nPoda} entradas anteriores a ${limitePoda}`)
      if (DRY_RUN) {
        const muestra = Object.entries(porCodigo).slice(0, 3)
        for (const [codigo, s] of muestra) log(`  ej. ${codigo}: facturas ${Object.keys(s.facturas).slice(0, 5).join(', ')}${Object.keys(s.facturas).length > 5 ? '…' : ''} | remitos ${Object.keys(s.remitos).slice(0, 5).join(', ')}${Object.keys(s.remitos).length > 5 ? '…' : ''}`)
        const conCae = detallesAEscribir.filter((d) => d.doc.tipo !== 'REM' && d.doc.cae).length
        const sinCae = detallesAEscribir.filter((d) => d.doc.tipo !== 'REM' && !d.doc.cae).length
        log(`  facturas con CAE: ${conCae}, sin CAE: ${sinCae}; remitos: ${detallesAEscribir.filter((d) => d.doc.tipo === 'REM').length}`)
        continue
      }
      const n = await escribir(db, empresa, porCodigo, podados, detallesAEscribir, clientes, iso(desde))
      if (!SOLO_CLIENTE) writeFileSync(rutaCache(empresa), JSON.stringify(actualizarCache(cache, porCodigo, podados)), 'utf8')
      log(`  ${empresa}: ${n} escrituras OK`)
    } catch (e) {
      fallas++
      log(`  ${empresa}: ERROR ${e.stack ?? e.message}`)
    }
  }
  for (const p of pools.values()) await p.close()
  log(fallas ? `Terminado con ${fallas} error(es).` : 'Terminado OK.')
  process.exit(fallas ? 1 : 0)
}

main().catch((err) => { log(`ERROR FATAL: ${err.stack ?? err.message}`); process.exit(1) })
