/**
 * comprobantes-sync.mjs — facturas y remitos de Tango → Firestore (SOLO LEE SQL).
 *
 * Módulo que corre EN EL SERVIDOR DE TANGO (RHIELOTG) adentro de bridge-sql.mjs (cada
 * `config/tango.comprobantes.intervaloMin` minutos, default 60, y a pedido desde la app
 * vía tango-consultas tipo 'sincronizarComprobantes'); bridge-sync-comprobantes.mjs lo
 * envuelve para correrlo a mano (--dry-run, --backfill, --cliente=). Misma config que el
 * bridge (bridge-sql.config.json: login SQL `rolito_bridge` con db_datareader).
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
 * GVA01 (condiciones de venta), GVA23 (vendedores), GVA14 (clientes, con E_MAIL), STA11.
 *
 * Cada corrida trae los últimos `diasVentana` (45) días y escribe SOLO lo nuevo o
 * cambiado (huella por comprobante, cache local comprobantes-cache.{empresa}.json).
 * Una entrada más vieja que 13 meses se sale del índice (el detalle queda). Lotes de 200
 * con pausa y reintento (el backfill de 66.000 escrituras cortó el stream de Firestore);
 * el cache avanza por código confirmado, así una corrida cortada retoma sin repetir.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { createRequire } from 'module'
import { doc, writeBatch, serverTimestamp, deleteField } from 'firebase/firestore'
import {
  MESES_HISTORIAL, aPodar, actualizarCache, diferencias, iso, mapearFacturas, mapearRemitos, relacionDeFilas,
  restarDias, restarMeses,
} from './comprobantes-tango.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const mssql = require('mssql')

export const DIAS_VENTANA_DEFAULT = 45
export const DIAS_BACKFILL_DEFAULT = 400
const LOTE = 200
const PAUSA_MS = 300
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── SQL ──────────────────────────────────────────────────────────────────────
const pools = new Map()
async function pool(cfg, database) {
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
/** Cierra las conexiones SQL abiertas por el módulo (para el wrapper de línea de comandos). */
export async function cerrarConexiones() {
  for (const p of pools.values()) await p.close().catch(() => {})
  pools.clear()
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

/** Filtro SQL por códigos de cliente (lista) y sus parámetros. */
function filtroClientes(codigos, col) {
  if (!codigos?.length) return { sql: '', params: {} }
  const params = Object.fromEntries(codigos.map((c, i) => [`c${i}`, c]))
  return { sql: ` AND ${col} IN (${codigos.map((_, i) => `@c${i}`).join(', ')})`, params }
}

async function leerEmpresa({ cfg, log }, empresa, database, desde, codigos) {
  const p = await pool(cfg, database)
  const fc = (col) => filtroClientes(codigos, col)
  const params = { desde, ...fc('x').params }
  const t0 = Date.now()

  const facturas = await consulta(p, `
    SELECT ID_GVA12, T_COMP, N_COMP, FECHA_EMIS, IMPORTE, IMPORTE_GR, IMPORTE_EX, IMPORTE_IV, IMPORTE_IN, ESTADO, COD_CLIENT,
           CAT_IVA, COND_VTA, COD_VENDED, CAICAE, CAICAE_VTO, FECHA_ANU
    FROM GVA12 WHERE T_COMP IN ('FAC','N/C','N/D') AND FECHA_EMIS >= @desde${fc('COD_CLIENT').sql}`, params)
  const renglonesFac = await consulta(p, `
    SELECT r.T_COMP, r.N_COMP, r.N_RENGL_V, r.COD_ARTICU, a.DESCRIPCIO, r.CANTIDAD, r.PRECIO_NET, r.PORC_DTO, r.PORC_IVA, r.IMP_NETO_P
    FROM GVA53 r JOIN GVA12 f ON f.T_COMP = r.T_COMP AND f.N_COMP = r.N_COMP LEFT JOIN STA11 a ON a.COD_ARTICU = r.COD_ARTICU
    WHERE f.T_COMP IN ('FAC','N/C','N/D') AND f.FECHA_EMIS >= @desde${fc('f.COD_CLIENT').sql}`, params)
  const remitos = await consulta(p, `
    SELECT ID_STA14, N_COMP, FECHA_MOV, ESTADO_MOV, COD_PRO_CL, TALONARIO, USUARIO, FECHA_ANU
    FROM STA14 WHERE T_COMP = 'REM' AND FECHA_MOV >= @desde${fc('COD_PRO_CL').sql}`, params)
  const renglonesRem = await consulta(p, `
    SELECT r.ID_STA14, r.N_RENGL_S, r.COD_ARTICU, a.DESCRIPCIO, r.CANTIDAD
    FROM STA20 r JOIN STA14 s ON s.ID_STA14 = r.ID_STA14 LEFT JOIN STA11 a ON a.COD_ARTICU = r.COD_ARTICU
    WHERE s.T_COMP = 'REM' AND s.FECHA_MOV >= @desde${fc('s.COD_PRO_CL').sql}`, params)
  // Relación por las dos puntas: facturas de la ventana (con remitos de cualquier fecha) y
  // remitos de la ventana (con facturas de cualquier fecha).
  const relacion = await consulta(p, `
    SELECT g.T_COMP_V, g.N_COMP, s.N_COMP AS REMITO
    FROM GVA54 g JOIN GVA12 f ON f.T_COMP = g.T_COMP_V AND f.N_COMP = g.N_COMP
    JOIN STA14 s ON s.TCOMP_IN_S = g.TCOMP_IN_S AND s.NCOMP_IN_S = g.NCOMP_IN_S
    WHERE (f.FECHA_EMIS >= @desde OR s.FECHA_MOV >= @desde)${fc('f.COD_CLIENT').sql}
    GROUP BY g.T_COMP_V, g.N_COMP, s.N_COMP`, params)
  const talonarios = Object.fromEntries((await consulta(p, `SELECT TALONARIO, CAI, FECHA_VTO, DESCRIP FROM GVA43 WHERE COMPROB = 'REM'`)).map((t) => [String(Number(t.TALONARIO)), t]))
  const condiciones = Object.fromEntries((await consulta(p, `SELECT COND_VTA, DESC_COND FROM GVA01`)).map((c) => [String(c.COND_VTA), String(c.DESC_COND ?? '').trim()]))
  const vendedores = Object.fromEntries((await consulta(p, `SELECT COD_GVA23, NOMBRE_VEN FROM GVA23`)).map((v) => [String(v.COD_GVA23 ?? '').trim(), String(v.NOMBRE_VEN ?? '').trim()]))

  const colsCliente = await columnasDe(p, 'GVA14')
  const pedir = ['COD_GVA14', 'RAZON_SOCI', 'CUIT', 'DOMICILIO', 'LOCALIDAD', 'C_POSTAL', 'COD_PROVIN', 'CAT_IVA', 'IVA', 'E_MAIL', 'EMAIL'].filter((c) => colsCliente.has(c))
  const clientes = Object.fromEntries((await consulta(p, `SELECT ${pedir.join(', ')} FROM GVA14`)).map((c) => [String(c.COD_GVA14 ?? '').trim(), c]))

  log(`  ${empresa}: ${facturas.length} facturas (${renglonesFac.length} renglones), ${remitos.length} remitos (${renglonesRem.length} renglones), ${relacion.length} cruces, ${Object.keys(clientes).length} clientes — ${((Date.now() - t0) / 1000).toFixed(1)} s`)

  const { porFactura, porRemito } = relacionDeFilas(relacion)
  const f = mapearFacturas({ empresa, facturas, renglones: renglonesFac, remitosPorFactura: porFactura, clientes, condiciones, vendedores })
  const r = mapearRemitos({ empresa, remitos, renglones: renglonesRem, facturasPorRemito: porRemito, talonarios, clientes, condiciones })
  return { resumenFacturas: f.resumen, resumenRemitos: r.resumen, detalles: [...f.detalles, ...r.detalles], clientes, conteo: { facturas: facturas.length, remitos: remitos.length } }
}

// ── Cache local ──────────────────────────────────────────────────────────────
const rutaCache = (empresa) => path.join(__dirname, `comprobantes-cache.${empresa}.json`)
function leerCache(empresa) {
  try { return existsSync(rutaCache(empresa)) ? JSON.parse(readFileSync(rutaCache(empresa), 'utf8')) : {} } catch { return {} }
}

// ── Firestore ────────────────────────────────────────────────────────────────
// Un writeBatch no se puede volver a enviar después de un commit fallido: se arma uno nuevo
// por intento (armar() devuelve el batch cargado).
async function commitConReintento(log, armar, etiqueta) {
  for (let intento = 1; ; intento++) {
    try { await armar().commit(); return } catch (e) {
      if (intento >= 6) throw e
      const espera = Math.min(60_000, 2_000 * 2 ** (intento - 1))
      log(`  ${etiqueta}: falló (${e.code ?? e.message}); reintento ${intento} en ${espera / 1000} s`)
      await sleep(espera)
    }
  }
}

/**
 * Escribe detalles e índices por código de cliente: primero los detalles de un código y
 * al final su índice, así cuando un lote confirma se puede marcar en el cache TODO lo de
 * los códigos que quedaron completos. alConfirmar(codigosCompletos) recibe esa lista.
 */
async function escribir({ db, log }, empresa, porCodigo, podados, detalles, clientes, desdeIso, alConfirmar) {
  const detallesPorCodigo = new Map()
  for (const d of detalles) {
    const codigo = d.doc.codigo
    if (!detallesPorCodigo.has(codigo)) detallesPorCodigo.set(codigo, [])
    detallesPorCodigo.get(codigo).push(d)
  }
  const codigos = [...new Set([...Object.keys(porCodigo), ...Object.keys(podados)])]
  const ops = []   // { op, cierra?: codigo }
  for (const codigo of codigos) {
    for (const d of detallesPorCodigo.get(codigo) ?? []) ops.push({ op: (b) => b.set(doc(db, 'tangoComprobanteDetalle', d.id), { ...d.doc, actualizadoEn: serverTimestamp() }) })
    const cambios = porCodigo[codigo] ?? { facturas: {}, remitos: {} }
    const poda = podados[codigo] ?? { facturas: [], remitos: [] }
    const facturas = { ...cambios.facturas }
    const remitos = { ...cambios.remitos }
    for (const k of poda.facturas) facturas[k] = deleteField()
    for (const k of poda.remitos) remitos[k] = deleteField()
    // Mail de la ficha de Tango (2026-09-10): es el que usa la app para mandarle comprobantes al cliente.
    const email = String(clientes[codigo]?.E_MAIL ?? clientes[codigo]?.EMAIL ?? '').trim().toLowerCase()
    const datos = {
      empresa, codigo,
      razonSocial: String(clientes[codigo]?.RAZON_SOCI ?? '').trim(),
      email,
      desde: desdeIso,
      actualizadoEn: serverTimestamp(),
      facturas, remitos,
    }
    ops.push({ op: (b) => b.set(doc(db, 'tangoComprobantes', `${empresa}_${codigo}`), datos, { merge: true }), cierra: codigo })
  }
  for (let i = 0; i < ops.length; i += LOTE) {
    const tanda = ops.slice(i, i + LOTE)
    await commitConReintento(log, () => { const b = writeBatch(db); for (const { op } of tanda) op(b); return b }, `lote ${i / LOTE + 1}`)
    const completos = tanda.filter((x) => x.cierra).map((x) => x.cierra)
    if (completos.length && alConfirmar) alConfirmar(completos)
    if (ops.length > LOTE) log(`  escritos ${Math.min(i + LOTE, ops.length)}/${ops.length}`)
    if (i + LOTE < ops.length) await sleep(PAUSA_MS)
  }
  return ops.length
}

/**
 * Corre la sincronización. Opciones:
 *   cfg          config del bridge (sql.bases por empresa, comprobantes.diasVentana / diasBackfill)
 *   db           Firestore ya autenticado como bridge (null con dryRun)
 *   log          función de log
 *   dryRun       no escribe nada; muestra qué haría
 *   backfill     ventana de diasBackfill (400) días
 *   soloEmpresa  'redonhielo' | 'rolito'
 *   codigos      lista de códigos de cliente (a pedido desde la app: rápido, sin cache)
 *   dias         ventana en días (override)
 * Devuelve { ok, empresas: { [empresa]: { facturas, remitos, codigos, detalles, escrituras, error? } } }.
 */
export async function sincronizarComprobantes({ cfg, db, log, dryRun = false, backfill = false, soloEmpresa = null, codigos = null, dias = null }) {
  const opciones = { diasVentana: DIAS_VENTANA_DEFAULT, diasBackfill: DIAS_BACKFILL_DEFAULT, ...(cfg.comprobantes ?? {}) }
  const empresas = Object.entries(cfg.sql.bases ?? {}).filter(([e]) => !soloEmpresa || e === soloEmpresa)
  if (!empresas.length) throw new Error(`sin empresas para procesar (empresa=${soloEmpresa ?? ''})`)
  const listaCodigos = codigos?.map((c) => String(c).trim().toUpperCase()).filter(Boolean) ?? null
  const hoy = new Date()
  const desde = restarDias(hoy, dias ?? (backfill ? opciones.diasBackfill : opciones.diasVentana))
  const limitePoda = iso(restarMeses(hoy, MESES_HISTORIAL))
  log(`Comprobantes de Tango → app: ${dryRun ? 'DRY-RUN (no escribe)' : 'modo real'}${backfill ? ', BACKFILL' : ''}, desde ${iso(desde)}${listaCodigos ? `, solo ${listaCodigos.join(', ')}` : ''}`)

  const resultado = { ok: true, empresas: {} }
  for (const [empresa, database] of empresas) {
    try {
      log(`${empresa} (base ${database}):`)
      const { resumenFacturas, resumenRemitos, detalles, clientes, conteo } = await leerEmpresa({ cfg, log }, empresa, database, desde, listaCodigos)
      // A pedido (lista de códigos) no se usa el cache: se reescribe lo de esos códigos y listo.
      const cache = listaCodigos ? {} : leerCache(empresa)
      const { porCodigo, detallesAEscribir } = diferencias(cache, resumenFacturas, resumenRemitos, detalles)
      const podados = listaCodigos ? {} : aPodar(cache, limitePoda)
      const nCodigos = Object.keys(porCodigo).length
      const nPoda = Object.values(podados).reduce((s, x) => s + x.facturas.length + x.remitos.length, 0)
      log(`  cambios: ${nCodigos} códigos de cliente, ${detallesAEscribir.length} detalles; a podar: ${nPoda} entradas anteriores a ${limitePoda}`)
      const r = { ...conteo, codigos: nCodigos, detalles: detallesAEscribir.length, escrituras: 0 }
      resultado.empresas[empresa] = r
      if (dryRun) {
        for (const [codigo, s] of Object.entries(porCodigo).slice(0, 3)) log(`  ej. ${codigo}: facturas ${Object.keys(s.facturas).slice(0, 5).join(', ')}${Object.keys(s.facturas).length > 5 ? '…' : ''} | remitos ${Object.keys(s.remitos).slice(0, 5).join(', ')}${Object.keys(s.remitos).length > 5 ? '…' : ''}`)
        const conCae = detallesAEscribir.filter((d) => d.doc.tipo !== 'REM' && d.doc.cae).length
        const sinCae = detallesAEscribir.filter((d) => d.doc.tipo !== 'REM' && !d.doc.cae).length
        log(`  facturas con CAE: ${conCae}, sin CAE: ${sinCae}; remitos: ${detallesAEscribir.filter((d) => d.doc.tipo === 'REM').length}`)
        continue
      }
      if (!nCodigos && !nPoda) { log(`  ${empresa}: sin cambios`); continue }
      // El cache avanza por código confirmado y se graba cada tanto: si la corrida se corta, la
      // siguiente retoma desde ahí (los códigos no confirmados vuelven a escribirse, nada más).
      let cacheActual = cache
      let pendientesDeGrabar = 0
      const grabarCache = () => { if (!listaCodigos) writeFileSync(rutaCache(empresa), JSON.stringify(cacheActual), 'utf8'); pendientesDeGrabar = 0 }
      const alConfirmar = (cods) => {
        const parcial = Object.fromEntries(cods.filter((c) => porCodigo[c]).map((c) => [c, porCodigo[c]]))
        const podaParcial = Object.fromEntries(cods.filter((c) => podados[c]).map((c) => [c, podados[c]]))
        cacheActual = actualizarCache(cacheActual, parcial, podaParcial)
        if (++pendientesDeGrabar >= 10) grabarCache()
      }
      try {
        r.escrituras = await escribir({ db, log }, empresa, porCodigo, podados, detallesAEscribir, clientes, iso(desde), alConfirmar)
      } finally {
        grabarCache()
      }
      log(`  ${empresa}: ${r.escrituras} escrituras OK`)
    } catch (e) {
      resultado.ok = false
      resultado.empresas[empresa] = { ...(resultado.empresas[empresa] ?? {}), error: e.message }
      log(`  ${empresa}: ERROR ${e.stack ?? e.message}`)
    }
  }
  log(resultado.ok ? 'Comprobantes: terminado OK.' : 'Comprobantes: terminado con errores.')
  return resultado
}
