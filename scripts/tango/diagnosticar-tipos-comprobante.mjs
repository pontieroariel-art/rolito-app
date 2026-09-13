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
  // TCOMP_IN_V es la CLASE interna del comprobante en Tango — FC factura, CC crédito,
  // DC débito, RC recibo — y es lo que distingue un crédito de un débito, porque los
  // importes de GVA12 son todos positivos. Se agrupa sin parámetros a propósito: comparar
  // texto con un parámetro choca con la collation Latin1_General_BIN de las columnas.
  const clases = await intentar('clase por tipo', () => consulta(p, `
    SELECT T_COMP, TCOMP_IN_V, COUNT(*) AS N FROM GVA12 GROUP BY T_COMP, TCOMP_IN_V`)) ?? []
  const clasePorTipo = {}
  for (const c of clases) {
    const k = String(c.T_COMP ?? '').trim()
    const v = String(c.TCOMP_IN_V ?? '').trim() || '(vacío)'
    clasePorTipo[k] = clasePorTipo[k] ? `${clasePorTipo[k]}+${v}` : v
  }

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

  log(`\nTIPO  CLASE   CANT.    DESDE       HASTA       CAE      RENGL.   EJEMPLO           NOMBRE EN TANGO (talonarios)`)
  log('─'.repeat(110))
  for (const t of tipos) {
    const cod = String(t.T_COMP ?? '').trim()
    const signo = t.NEGATIVOS && !t.POSITIVOS ? 'negativo' : t.POSITIVOS && !t.NEGATIVOS ? 'positivo' : 'mezcla'
    const cae = t.CON_CAE === t.CANTIDAD ? 'todos' : t.CON_CAE ? `${t.CON_CAE}/${t.CANTIDAD}` : 'ninguno'
    const ren = t.CON_RENGLONES === t.CANTIDAD ? 'todos' : t.CON_RENGLONES ? `${t.CON_RENGLONES}/${t.CANTIDAD}` : 'ninguno'
    log(`${txt(cod, 5)} ${txt(clasePorTipo[cod] ?? signo.slice(0,0), 7)} ${nro(t.CANTIDAD, 7)}  ${fecha(t.DESDE)}  ${fecha(t.HASTA)}  ${txt(cae, 8)} ${txt(ren, 8)} ${txt(t.EJEMPLO, 17)} ${txt(desc[cod]?.DESCRIPCION ?? '(sin talonario)', 34)}`)
  }

  // (c) Un ejemplo entero de cada tipo que NO sea factura: para ver de qué se trata.
  log(`\nEJEMPLO DE CADA TIPO (el más reciente que no sea FAC)`)
  log('─'.repeat(110))
  // El más reciente de cada tipo en UNA consulta con ROW_NUMBER, sin comparar texto contra un
  // parámetro: esa comparación choca con la collation de las columnas de Tango (Latin1_General_BIN)
  // y en la base de Rolito ni COLLATE DATABASE_DEFAULT alcanza. El único parámetro es la fecha.
  const ejemplos = await intentar('ejemplos por tipo', () => consulta(p, `
    SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY T_COMP ORDER BY FECHA_EMIS DESC) AS RN
      FROM GVA12 WHERE FECHA_EMIS >= @desde
    ) x WHERE RN = 1`, { desde })) ?? []
  const renglonesTodos = await intentar('renglones de los ejemplos', () => consulta(p, `
    SELECT r.T_COMP, r.N_COMP, r.COD_ARTICU, a.DESCRIPCIO, r.CANTIDAD
    FROM GVA53 r
    LEFT JOIN STA11 a ON a.COD_ARTICU = r.COD_ARTICU
    WHERE r.N_COMP IN (SELECT N_COMP FROM (
      SELECT N_COMP, ROW_NUMBER() OVER (PARTITION BY T_COMP ORDER BY FECHA_EMIS DESC) AS RN
      FROM GVA12 WHERE FECHA_EMIS >= @desde) y WHERE RN = 1)`, { desde })) ?? []

  for (const t of tipos) {
    const cod = String(t.T_COMP ?? '').trim()
    if (cod === 'FAC') continue
    const e = ejemplos.find((x) => String(x.T_COMP ?? '').trim() === cod)
    if (!e) continue
    const renglones = renglonesTodos
      .filter((r) => String(r.N_COMP ?? '').trim() === String(e.N_COMP ?? '').trim())
      .slice(0, 3)
    log(`${txt(cod, 5)} ${txt(e.N_COMP, 17)} ${fecha(e.FECHA_EMIS)}  ${nro(Number(e.IMPORTE ?? 0).toFixed(2), 14)}  estado ${txt(e.ESTADO, 4)} cliente ${txt(e.COD_CLIENT, 10)}`)
    // Las columnas que dicen QUÉ es el comprobante: el tipo de ARCA (1 = Factura A, 2 = ND A,
    // 3 = NC A, 6/7/8 = B…), la letra, el talonario y cualquier marca de clase o signo.
    const interesa = /AFIP|ARCA|TIPO|CLASE|LETRA|TALON|SIGNO|COMP|CAE|CAI/i
    const campos = Object.entries(e)
      .filter(([k, v]) => interesa.test(k) && v !== null && String(v).trim() !== '' && String(v).trim() !== '0')
      .map(([k, v]) => `${k}=${String(v instanceof Date ? fecha(v) : v).trim().slice(0, 24)}`)
    log(`        campos: ${campos.join('  ')}`)
    for (const r of renglones) log(`        · ${txt(r.DESCRIPCIO ?? r.COD_ARTICU, 40)} x${r.CANTIDAD}`)
    if (!renglones.length) log('        · (sin renglones: es un comprobante por importe, no por artículos)')
  }

  // (d) Tabla maestra de tipos de comprobante: se busca por su forma (una columna T_COMP y
  //     alguna DESCRIP*), porque el nombre cambia entre versiones de Tango. Si es chica, se
  //     lista entera: ahí está el nombre oficial de cada código.
  log(`\nTABLAS QUE DEFINEN TIPOS DE COMPROBANTE (nombre oficial de cada código)`)
  log('─'.repeat(110))
  // No se pide que tenga una columna DESCRIP*: la maestra puede llamarla NOMBRE o LEYENDA.
  // El filtro real es el TAMAÑO: una tabla de tipos tiene decenas de filas, no miles.
  const candidatas = await intentar('tablas candidatas', () => consulta(p, `
    SELECT t.TABLE_NAME
    FROM INFORMATION_SCHEMA.COLUMNS t
    WHERE t.COLUMN_NAME IN ('T_COMP', 'COMPROB', 'COD_COMPROB', 'TIPO_COMP')
    GROUP BY t.TABLE_NAME
    ORDER BY t.TABLE_NAME`)) ?? []
  for (const t of candidatas) {
    const tabla = t.TABLE_NAME
    const [{ N } = { N: 0 }] = await intentar(`filas de ${tabla}`, () => consulta(p, `SELECT COUNT(*) AS N FROM [${tabla}]`)) ?? []
    if (!N || N > 200) continue   // miles de filas = tabla de movimientos, no el maestro
    const filas = await intentar(`contenido de ${tabla}`, () => consulta(p, `SELECT TOP 200 * FROM [${tabla}]`)) ?? []
    log(`\n${tabla} (${N} filas):`)
    for (const f of filas) {
      const cod = f.T_COMP ?? f.COMPROB ?? f.COD_COMPROB ?? f.TIPO_COMP
      // Todo lo que sea texto y no el código: ahí está el nombre, se llame como se llame.
      const textos = Object.entries(f)
        .filter(([k, v]) => typeof v === 'string' && v.trim() && !['T_COMP', 'COMPROB', 'COD_COMPROB', 'TIPO_COMP'].includes(k))
        .map(([k, v]) => `${k}=${v.trim().slice(0, 30)}`)
      log(`   ${txt(cod, 6)} ${textos.join('  ').slice(0, 100)}`)
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
