/**
 * diagnosticar-tipos-comprobante.mjs — qué es cada T_COMP de GVA12 (SOLO LEE).
 *
 * Corre EN LA VM de Tango, en C:\RolitoSync\sql\ (usa bridge-sql.config.json y sus
 * node_modules). No toca Firestore ni escribe nada en SQL.
 *
 *   node diagnosticar-tipos-comprobante.mjs                 las dos empresas, 400 días
 *   node diagnosticar-tipos-comprobante.mjs --dias=1000     otra ventana
 *   node diagnosticar-tipos-comprobante.mjs --empresa=redonhielo
 *
 * Por qué (2026-09-13): al sacar el filtro por tipo del lector aparecieron 16 códigos en
 * Redonhielo (FAC, REC, C/E, CDP, NCB, DEB, CFC, N/D, CDV, CIN, DIN, D/B, NC, NCT, CEF, CAR)
 * y nadie en la empresa sabe de memoria cuál es cuál. En vez de adivinar el rótulo de cada uno
 * en la app, se lee lo que Tango dice: la descripción de sus talonarios (GVA43) y cómo se
 * comportan los comprobantes (signo del importe, si tienen renglones, si tienen CAE).
 *
 * La salida se pega en la conversación y con eso se rotulan los tipos en
 * src/utils/comprobantesLote.ts (TITULO_TIPO) y se decide en qué filtro va cada uno.
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const mssql = require('mssql')

const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null }
const DIAS = Number(arg('dias') ?? 400)
const SOLO_EMPRESA = arg('empresa')

const cfg = JSON.parse(readFileSync(path.join(__dirname, 'bridge-sql.config.json'), 'utf8'))
const log = (...x) => console.log(...x)

async function abrir(database) {
  const p = new mssql.ConnectionPool({
    server: cfg.sql.server, database, user: cfg.sql.user, password: cfg.sql.password, port: cfg.sql.port ?? 1433,
    options: { encrypt: cfg.sql.encrypt ?? false, trustServerCertificate: true, enableArithAbort: true, useUTC: false },
    pool: { max: 2, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 10 * 60 * 1000,
  })
  await p.connect()
  return p
}

const consulta = async (p, sql, params = {}) => {
  const req = new mssql.Request(p)
  for (const [k, v] of Object.entries(params)) req.input(k, v instanceof Date ? mssql.DateTime : mssql.VarChar(50), v)
  return (await req.query(sql)).recordset ?? []
}

/** Corre un bloque del diagnóstico sin que un error se lleve puesto al resto de la salida. */
const intentar = async (que, fn) => { try { return await fn() } catch (e) { log(`  [${que}] no se pudo: ${e.message}`); return null } }

const txt = (v, n) => String(v ?? '').trim().padEnd(n).slice(0, n)
const nro = (v, n) => String(v ?? '').padStart(n)
const fecha = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '—')

async function empresa(nombre, database, desde) {
  log(`\n${'═'.repeat(110)}\n${nombre.toUpperCase()} (base ${database}) — desde ${fecha(desde)}\n${'═'.repeat(110)}`)
  const p = await abrir(database)

  // (a) Cada tipo: cuántos, desde/hasta, signo del importe, cuántos tienen renglones y CAE.
  //     El signo es lo que dice si el comprobante SUMA o RESTA en la cuenta del cliente.
  const tipos = await intentar('conteo por tipo', () => consulta(p, `
    SELECT f.T_COMP,
           COUNT(*)                                            AS CANTIDAD,
           MIN(f.FECHA_EMIS)                                    AS DESDE,
           MAX(f.FECHA_EMIS)                                    AS HASTA,
           SUM(CASE WHEN f.IMPORTE < 0 THEN 1 ELSE 0 END)       AS NEGATIVOS,
           SUM(CASE WHEN f.IMPORTE > 0 THEN 1 ELSE 0 END)       AS POSITIVOS,
           SUM(CASE WHEN LTRIM(RTRIM(ISNULL(f.CAICAE, ''))) <> '' THEN 1 ELSE 0 END) AS CON_CAE,
           SUM(CASE WHEN r.N IS NULL THEN 0 ELSE 1 END)         AS CON_RENGLONES,
           MAX(f.N_COMP)                                        AS EJEMPLO
    FROM GVA12 f
    OUTER APPLY (SELECT TOP 1 1 AS N FROM GVA53 g WHERE g.T_COMP = f.T_COMP AND g.N_COMP = f.N_COMP) r
    WHERE f.FECHA_EMIS >= @desde
    GROUP BY f.T_COMP
    ORDER BY COUNT(*) DESC`, { desde })) ?? []

  // (b) Cómo llama Tango a cada tipo en sus talonarios. La columna de la descripción cambia
  //     de nombre entre versiones (DESCRIP / DESCRIPCIO / DESCRIPCION): se busca cuál existe.
  const cols = new Set((await intentar('columnas de GVA43', () => consulta(p, `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('GVA43')`)) ?? []).map((c) => c.name))
  //     El tipo del talonario está en COMPROB en esta instalación (en otras, T_COMP): las dos
  //     columnas se buscan en sys.columns antes de consultar, para no adivinar el esquema.
  const colDesc = ['DESCRIP', 'DESCRIPCIO', 'DESCRIPCION'].find((c) => cols.has(c))
  const colTipo = ['COMPROB', 'T_COMP', 'TIPO_COMP'].find((c) => cols.has(c))
  const talonarios = colDesc && colTipo
    ? await intentar('talonarios de GVA43', () => consulta(p, `SELECT ${colTipo} AS TIPO, COUNT(*) AS TALONARIOS, MIN(${colDesc}) AS DESCRIPCION FROM GVA43 GROUP BY ${colTipo}`)) ?? []
    : []
  if (!colDesc || !colTipo) log(`  (GVA43: no encontré tipo/descripción. Columnas: ${[...cols].join(', ')})`)
  const desc = Object.fromEntries(talonarios.map((t) => [String(t.TIPO ?? '').trim(), t]))

  log(`\nTIPO  CANT.    DESDE       HASTA       IMPORTE     CAE      RENGL.   EJEMPLO           NOMBRE EN TANGO (talonarios)`)
  log('─'.repeat(110))
  for (const t of tipos) {
    const cod = String(t.T_COMP ?? '').trim()
    const signo = t.NEGATIVOS && !t.POSITIVOS ? 'negativo' : t.POSITIVOS && !t.NEGATIVOS ? 'positivo' : 'mezcla'
    const cae = t.CON_CAE === t.CANTIDAD ? 'todos' : t.CON_CAE ? `${t.CON_CAE}/${t.CANTIDAD}` : 'ninguno'
    const ren = t.CON_RENGLONES === t.CANTIDAD ? 'todos' : t.CON_RENGLONES ? `${t.CON_RENGLONES}/${t.CANTIDAD}` : 'ninguno'
    log(`${txt(cod, 5)} ${nro(t.CANTIDAD, 7)}  ${fecha(t.DESDE)}  ${fecha(t.HASTA)}  ${txt(signo, 10)}  ${txt(cae, 8)} ${txt(ren, 8)} ${txt(t.EJEMPLO, 17)} ${txt(desc[cod]?.DESCRIPCION ?? '(sin talonario)', 34)}`)
  }

  // (c) Un ejemplo entero de cada tipo que NO sea factura: para ver de qué se trata.
  log(`\nEJEMPLO DE CADA TIPO (el más reciente que no sea FAC)`)
  log('─'.repeat(110))
  for (const t of tipos) {
    const cod = String(t.T_COMP ?? '').trim()
    if (cod === 'FAC') continue
    const [e] = await intentar(`ejemplo de ${cod}`, () => consulta(p, `
      SELECT TOP 1 f.N_COMP, f.FECHA_EMIS, f.IMPORTE, f.ESTADO, f.COD_CLIENT, c.RAZON_SOCI
      FROM GVA12 f LEFT JOIN GVA14 c ON c.COD_GVA14 = f.COD_CLIENT
      WHERE f.T_COMP = @t AND f.FECHA_EMIS >= @desde ORDER BY f.FECHA_EMIS DESC`, { t: cod, desde })) ?? []
    if (!e) continue
    const renglones = await intentar(`renglones de ${cod}`, () => consulta(p, `
      SELECT TOP 3 r.COD_ARTICU, a.DESCRIPCIO, r.CANTIDAD, r.PRECIO_NET
      FROM GVA53 r LEFT JOIN STA11 a ON a.COD_ARTICU = r.COD_ARTICU
      WHERE r.T_COMP = @t AND r.N_COMP = @n`, { t: cod, n: String(e.N_COMP ?? '').trim() })) ?? []
    log(`${txt(cod, 5)} ${txt(e.N_COMP, 17)} ${fecha(e.FECHA_EMIS)}  ${nro(Number(e.IMPORTE ?? 0).toFixed(2), 14)}  estado ${txt(e.ESTADO, 4)} ${txt(e.RAZON_SOCI, 30)}`)
    for (const r of renglones) log(`        · ${txt(r.DESCRIPCIO ?? r.COD_ARTICU, 40)} x${r.CANTIDAD}`)
    if (!renglones.length) log('        · (sin renglones: es un comprobante por importe, no por artículos)')
  }

  // (d) Tabla maestra de tipos de comprobante: se busca por su forma (una columna T_COMP y
  //     alguna DESCRIP*), porque el nombre cambia entre versiones de Tango. Si es chica, se
  //     lista entera: ahí está el nombre oficial de cada código.
  log(`\nTABLAS QUE DEFINEN TIPOS DE COMPROBANTE (nombre oficial de cada código)`)
  log('─'.repeat(110))
  const candidatas = await intentar('tablas candidatas', () => consulta(p, `
    SELECT c1.TABLE_NAME, MIN(c2.COLUMN_NAME) AS COL_DESC
    FROM INFORMATION_SCHEMA.COLUMNS c1
    JOIN INFORMATION_SCHEMA.COLUMNS c2 ON c2.TABLE_NAME = c1.TABLE_NAME AND c2.COLUMN_NAME LIKE 'DESCRIP%'
    WHERE c1.COLUMN_NAME IN ('T_COMP', 'COMPROB', 'COD_COMPROB', 'TIPO_COMP')
    GROUP BY c1.TABLE_NAME`)) ?? []
  for (const t of candidatas) {
    const tabla = t.TABLE_NAME
    const [{ N } = { N: 0 }] = await intentar(`filas de ${tabla}`, () => consulta(p, `SELECT COUNT(*) AS N FROM ${tabla}`)) ?? []
    if (!N || N > 120) { log(`${txt(tabla, 16)} ${N} filas (muy grande: no es la tabla de tipos)`); continue }
    const filas = await intentar(`contenido de ${tabla}`, () => consulta(p, `SELECT TOP 120 * FROM ${tabla}`)) ?? []
    log(`\n${tabla} (${N} filas):`)
    for (const f of filas) {
      const cod = f.T_COMP ?? f.COMPROB ?? f.COD_COMPROB ?? f.TIPO_COMP
      const d = Object.entries(f).find(([k]) => k.startsWith('DESCRIP'))?.[1]
      log(`   ${txt(cod, 6)} ${txt(d, 50)}`)
    }
  }

  await p.close()
}

const desde = new Date(Date.now() - DIAS * 24 * 3600 * 1000)
const bases = cfg.sql.bases   // { redonhielo: 'REDONHIELO_SA', rolito: 'Rolito' }
for (const [nombre, database] of Object.entries(bases)) {
  if (SOLO_EMPRESA && SOLO_EMPRESA !== nombre) continue
  try { await empresa(nombre, database, desde) } catch (e) { log(`\n${nombre}: ERROR — ${e.message}`) }
}
log('\nListo. Pegá esta salida en la conversación para rotular cada tipo en la app.')
process.exit(0)
