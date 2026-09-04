/**
 * bridge-sql.mjs — remitos y recibos de la app → base SQL Server de Tango.
 *
 * Corre EN EL SERVIDOR DE TANGO (RHIELOTG), donde vive SQL Server. Escucha
 * `tango-outbox` (entidades 'remito' y 'recibo') con el usuario `tango-bridge`
 * (solo puede leer la cola y actualizar estado/resultado — ver firestore.rules) y
 * escribe cada comprobante en la base de la empresa dentro de UNA transacción,
 * copiando lo que hace Tango (docs/tango/INTEGRACION.md §20/§21, trazas en
 * docs/tango/sql/). La lógica de qué escribir vive en functions/src/services/tango/sql
 * (compilada a functions/lib/services/tango/sql) — acá solo se ejecuta.
 *
 * Instalación (una vez, en C:\RolitoSync\sql\):
 *   1. Copiar: bridge-sql.mjs, bridge-sql.config.json (desde el .example), y la
 *      carpeta functions/lib/services/tango/sql/ del repo (tipos.js, remito.js, recibo.js)
 *      como C:\RolitoSync\sql\lib\.
 *   2. `npm init -y && npm i firebase mssql` en esa carpeta (Node 22).
 *   3. Probar: node bridge-sql.mjs --dry-run   (ejecuta todo y REVIERTE; no deja nada en Tango)
 *   4. Servicio: Task Scheduler "al iniciar el equipo", node.exe C:\RolitoSync\sql\bridge-sql.mjs
 *
 * Flags en config/tango (Firestore): remitosSqlEnabled / recibosSqlEnabled (default false).
 * El worker de la nube (tangoWorker) NO toca 'remito' ni 'recibo' mientras
 * config/tango.remitosEnabled siga en false (así fue decidido: §14/§20).
 */

import { readFileSync, appendFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { createRequire } from 'module'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, collection, query, where, onSnapshot, getDocs, getDoc, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const sqlLib = (f) => require(path.join(__dirname, 'lib', f))
const { escribirRemito, remitoDeVenta } = sqlLib('remito.js')
const { escribirRecibo, reciboDeCobranza } = sqlLib('recibo.js')
const mssql = require('mssql')

const DRY_RUN = process.argv.includes('--dry-run')
const UNA_VEZ = process.argv.includes('--once')
const CONFIG_PATH = path.join(__dirname, 'bridge-sql.config.json')
const MAX_INTENTOS = 5
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const HEARTBEAT_INTERVAL_MS = 60 * 1000

function cargarConfig() {
  const texto = readFileSync(CONFIG_PATH, 'utf8')
  const cfg = JSON.parse(texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto)
  const chequear = (obj, prefijo = '') => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.includes('_AQUI')) { console.error(`Falta completar "${prefijo}${k}" en ${CONFIG_PATH}.`); process.exit(1) }
      if (v && typeof v === 'object') chequear(v, `${prefijo}${k}.`)
    }
  }
  chequear(cfg)
  return cfg
}
const cfg = cargarConfig()

function log(linea) {
  const conFecha = `[${new Date().toISOString()}] ${linea}`
  console.log(conFecha)
  try { appendFileSync(cfg.logFile, conFecha + '\n', 'utf8') } catch { /* best effort */ }
}

// ── SQL Server ───────────────────────────────────────────────────────────────
const pools = new Map()
async function pool(database) {
  if (!pools.has(database)) {
    const p = new mssql.ConnectionPool({
      server: cfg.sql.server, database, user: cfg.sql.user, password: cfg.sql.password,
      port: cfg.sql.port ?? 1433,
      options: { encrypt: cfg.sql.encrypt ?? false, trustServerCertificate: true, enableArithAbort: true },
      pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
    })
    await p.connect()
    pools.set(database, p)
  }
  return pools.get(database)
}

// Del tipo declarado en las sentencias (functions/src/services/tango/sql/tipos.ts) al tipo de mssql.
function tipoMssql(t) {
  switch (t.kind) {
    case 'varchar': return mssql.VarChar(t.length)
    case 'numeric': return mssql.Numeric(t.precision, t.scale)
    case 'datetime': return mssql.DateTime
    case 'bit': return mssql.Bit
    case 'int': return mssql.Int
    case 'smallint': return mssql.SmallInt
    case 'float': return mssql.Float
    case 'text': return mssql.Text
    default: throw new Error(`tipo SQL desconocido: ${t.kind}`)
  }
}

/** EjecutorSql atado a una transacción: devuelve filas, o [{affected}] si no hubo recordset. */
function ejecutorDe(tx) {
  return {
    async query(sql, params = []) {
      const req = new mssql.Request(tx)
      for (const p of params) req.input(p.nombre, tipoMssql(p.tipo), p.valor)
      const res = await req.query(sql)
      if (res.recordset && res.recordset.length) return res.recordset
      return [{ affected: res.rowsAffected?.[0] ?? 0 }]
    },
  }
}

/** Ejecuta `fn(ejecutor)` en una transacción; con --dry-run la revierte siempre. */
async function enTransaccion(database, fn) {
  const p = await pool(database)
  const tx = new mssql.Transaction(p)
  await tx.begin(mssql.ISOLATION_LEVEL.READ_COMMITTED)
  try {
    const r = await fn(ejecutorDe(tx))
    if (DRY_RUN) { await tx.rollback(); log('  (dry-run) transacción REVERTIDA'); return r }
    await tx.commit()
    return r
  } catch (e) {
    try { await tx.rollback() } catch { /* ya revertida */ }
    throw e
  }
}

// ── Firestore: config y cola ─────────────────────────────────────────────────
async function configTango(db) {
  const snap = await getDoc(doc(db, 'config/tango'))
  return snap.data() ?? {}
}

function baseDe(empresa) {
  const b = cfg.sql.bases?.[empresa]
  if (!b) throw new Error(`sin base SQL configurada para la empresa "${empresa}" (bridge-sql.config.json → sql.bases)`)
  return b
}

/** Config SQL de una entidad: config/tango.sql.<entidad>, con override por empresa en sql.empresas.<empresa>.<entidad>
 *  (los números de talonario son por empresa: en Rolito el 1105 ya es la factura B de ARCA). */
function sqlConfigDe(tcfg, entidad, empresa) {
  return { ...(tcfg.sql?.[entidad] ?? {}), ...(tcfg.sql?.empresas?.[empresa]?.[entidad] ?? {}) }
}

const HANDLERS = {
  remito: {
    flag: 'remitosSqlEnabled',
    async enviar(data, tcfg, docId) {
      const empresa = data.empresa ?? 'redonhielo'
      const sqlCfg = sqlConfigDe(tcfg, 'remito', empresa)
      if (!sqlCfg?.talonario || !sqlCfg?.puntoVenta) throw new Error('falta config/tango.sql.remito {talonario, puntoVenta, codigoTransporte, usuario, terminal}')
      const payload = data.payload ?? {}
      const dep = tcfg.depositos ?? {}
      const codDeposito = (payload.choferId && dep[payload.choferId]) || (payload.camionId && dep[payload.camionId])
      if (!codDeposito) throw new Error(`sin depósito de Tango para chofer ${payload.choferId} / camión ${payload.camionId} (config/tango.depositos)`)
      const remito = remitoDeVenta(payload, data.origenId ?? docId, tcfg.articulos ?? {}, codDeposito, sqlCfg.puntoVenta)
      const r = await enTransaccion(baseDe(empresa), (db) => escribirRemito(db, remito, {
        talonario: sqlCfg.talonario, puntoVenta: sqlCfg.puntoVenta, codigoTransporte: sqlCfg.codigoTransporte ?? '01',
        usuario: sqlCfg.usuario ?? 'ROLITO', terminal: sqlCfg.terminal ?? 'APP',
      }, (m) => log('    ' + m)))
      return { remitoNumero: r.nComp, idSta14: r.idSta14, ncompInS: r.ncompInS, yaExistia: r.yaExistia, via: 'sql' }
    },
  },
  recibo: {
    flag: 'recibosSqlEnabled',
    async enviar(data, tcfg, docId) {
      const empresa = data.empresa ?? data.payload?.empresa ?? 'redonhielo'
      const sqlCfg = sqlConfigDe(tcfg, 'recibo', empresa)
      if (!sqlCfg?.talonario || !sqlCfg?.puntoVenta || !sqlCfg?.cuentas || !sqlCfg?.cuentasContables || !sqlCfg?.idSba02Recibo) {
        throw new Error('falta config/tango.sql.recibo {talonario, puntoVenta, codVendedor, concepto, cuentas, cuentasContables, idSba02Recibo, usuario, terminal}')
      }
      const rcfg = {
        talonario: sqlCfg.talonario, puntoVenta: sqlCfg.puntoVenta, codVendedor: sqlCfg.codVendedor ?? 'AD',
        concepto: sqlCfg.concepto ?? 'COBRANZAS POR VENTAS', cuentas: sqlCfg.cuentas, cuentasContables: sqlCfg.cuentasContables,
        idSba02Recibo: sqlCfg.idSba02Recibo, usuario: sqlCfg.usuario ?? 'ROLITO', terminal: sqlCfg.terminal ?? 'APP',
      }
      const recibo = reciboDeCobranza(data.payload ?? {}, data.origenId ?? docId, rcfg)
      const r = await enTransaccion(baseDe(empresa), (db) => escribirRecibo(db, recibo, rcfg, (m) => log('    ' + m)))
      return { reciboNumero: r.nComp, idGva12: r.idGva12, nInternoSba04: r.nInternoSba04, yaExistia: r.yaExistia, via: 'sql' }
    },
  },
}

const enProceso = new Set()

async function procesarItem(db, docId, data) {
  if (enProceso.has(docId)) return
  if (!HANDLERS[data.entidad]) return
  enProceso.add(docId)
  try {
    const tcfg = await configTango(db)
    if (tcfg[HANDLERS[data.entidad].flag] !== true && !DRY_RUN) {
      log(`  ${docId}: config/tango.${HANDLERS[data.entidad].flag} no está en true; se deja pendiente`)
      return
    }
    if (!DRY_RUN) {
      await updateDoc(doc(db, 'tango-outbox', docId), { estado: 'enviado', intentos: (data.intentos ?? 0) + 1, actualizadoEn: serverTimestamp() })
    }
    log(`${docId}: ${data.entidad} (${data.empresa ?? '-'}) → SQL${DRY_RUN ? ' [dry-run]' : ''}`)
    let resultado
    try {
      resultado = await HANDLERS[data.entidad].enviar(data, tcfg, docId)
    } catch (e) {
      const intentos = (data.intentos ?? 0) + 1
      const estadoFinal = intentos >= MAX_INTENTOS ? 'error' : 'enviado'   // 'enviado' = lo reintenta el barrido (backoff de 5 min)
      log(`  ${docId}: falló (intento ${intentos}/${MAX_INTENTOS}) — ${e.message}`)
      if (!DRY_RUN) await updateDoc(doc(db, 'tango-outbox', docId), { estado: estadoFinal, ultimoError: e.message, actualizadoEn: serverTimestamp() })
      return
    }
    log(`  ${docId}: OK ${JSON.stringify(resultado)}`)
    if (!DRY_RUN) {
      await updateDoc(doc(db, 'tango-outbox', docId), { estado: 'confirmado', ultimoError: null, resultado, actualizadoEn: serverTimestamp() })
    }
  } catch (err) {
    log(`  ${docId}: ERROR inesperado — ${err.message}`)
  } finally {
    enProceso.delete(docId)
  }
}

async function barrido(db) {
  const q = query(collection(db, 'tango-outbox'), where('estado', 'in', ['pendiente', 'enviado']), where('entidad', 'in', ['remito', 'recibo']))
  const res = await getDocs(q)
  if (!res.empty) log(`Barrido: ${res.size} item(s) remito/recibo pendientes o a reintentar`)
  for (const d of res.docs) await procesarItem(db, d.id, d.data())
}

async function main() {
  const app = initializeApp(cfg.firebaseConfig)
  const auth = getAuth(app)
  const db = getFirestore(app)
  log(`Iniciando sesión como bridge (${DRY_RUN ? 'DRY-RUN: nada queda en Tango ni en la cola' : 'modo real'})...`)
  await signInWithEmailAndPassword(auth, cfg.tangoBridgeEmail, cfg.tangoBridgePassword)
  log(`Sesión OK. SQL Server ${cfg.sql.server}, bases ${JSON.stringify(cfg.sql.bases)}.`)

  await barrido(db)
  if (UNA_VEZ || DRY_RUN) { log('Listo (una sola pasada).'); for (const p of pools.values()) await p.close(); process.exit(0) }

  const q = query(collection(db, 'tango-outbox'), where('estado', '==', 'pendiente'), where('entidad', 'in', ['remito', 'recibo']))
  onSnapshot(q, (snap) => {
    for (const ch of snap.docChanges()) if (ch.type === 'added' || ch.type === 'modified') procesarItem(db, ch.doc.id, ch.doc.data())
  }, (err) => log(`ERROR en el listener (el SDK reintenta solo): ${err.message}`))
  setInterval(() => barrido(db).catch((e) => log(`ERROR en barrido: ${e.message}`)), SWEEP_INTERVAL_MS)
  // Mismo campo que usaba bridge-listener (es el único que las reglas le dejan tocar al bridge en config/tango).
  setInterval(() => updateDoc(doc(db, 'config/tango'), { bridgeListenerLastSeen: serverTimestamp() }).catch((e) => log(`ERROR heartbeat: ${e.message}`)), HEARTBEAT_INTERVAL_MS)
  log('Escuchando tango-outbox (remito, recibo)...')
}

main().catch((err) => { log(`ERROR FATAL: ${err.stack ?? err.message}`); process.exit(1) })
