/**
 * bridge-sync-saldos.mjs
 *
 * Corre EN LA VM de Tango (no en este repo, no en CI), programado con el
 * Task Scheduler de Windows (cada 1-2 horas — más frecuente que el sync de
 * clientes: es el cache que ven los supervisores al cobrar). Trae la
 * composición de saldos de los clientes (comprobantes pendientes de cobro,
 * con saldo restante) y se la manda en lotes a la Cloud Function
 * `syncSaldosTango`, que es la única con la clave de Firestore — este script
 * nunca la tiene.
 *
 * Fuente: las consultas LIVE de Tango (relevadas y probadas 2026-08-31, ver
 * docs/tango/INTEGRACION.md §6.1bis):
 *   - "Deudas vencidas"  (process 17953)
 *   - "Deudas a vencer"  (process en el config)
 * La suma de ambas = composición completa de la deuda viva.
 *
 * Formato confirmado contra el server real:
 *   GET {base}/Api/GetApiLiveQueryData?process=N&customQuery=0&fromDate=dd/MM/yyyy&toDate=dd/MM/yyyy&pageSize=500&pageIndex=0
 *   Headers: ApiAuthorization (token dev) + Company (1 = Redonhielo)
 *   → { resultData: { list, totalPages, ... }, succeeded }
 *   Fila: ID_GVA12 (id del comprobante), ID_GVA14 (id del cliente — matchea
 *   users.idGva14Tango), TIPO_COMPROBANTE, NRO_COMPROBANTE, CLIENTE
 *   ("COD - RAZON SOCIAL"), FECHA_DE_VENCIMIENTO (ISO),
 *   IMPORTE_AL_VENCIMIENTO_CTE, IMPORTE_PENDIENTE_CTE, DIAS_DE_ATRASO.
 *
 * Uso:
 *   1. Copiar este archivo + un `bridge-sync-saldos.config.json` (basado en
 *      `bridge-sync-saldos.config.example.json`) a C:\RolitoSync\.
 *   2. Probar a mano primero: node bridge-sync-saldos.mjs --dry-run
 *   3. Programar en Task Scheduler (cada 1-2 h, "Run whether user is logged on or not").
 */

import { readFileSync, appendFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, 'bridge-sync-saldos.config.json')
const DRY_RUN = process.argv.includes('--dry-run')

function cargarConfig() {
  let cfg
  try {
    const texto = readFileSync(CONFIG_PATH, 'utf8')
    // BOM del Bloc de notas — se ignora (mismo caso que bridge-sync-clientes).
    cfg = JSON.parse(texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto)
  } catch {
    console.error(`No se pudo leer ${CONFIG_PATH}. Copiá bridge-sync-saldos.config.example.json a bridge-sync-saldos.config.json y completá los valores reales.`)
    process.exit(1)
  }
  const chequear = (obj, prefijo = '') => {
    for (const [clave, valor] of Object.entries(obj)) {
      if (typeof valor === 'string' && valor.includes('_AQUI')) {
        console.error(`Falta completar "${prefijo}${clave}" en ${CONFIG_PATH}.`)
        process.exit(1)
      }
      if (valor && typeof valor === 'object') chequear(valor, `${prefijo}${clave}.`)
    }
  }
  chequear(cfg)
  return cfg
}

const cfg = cargarConfig()

function log(linea) {
  const conFecha = `[${new Date().toISOString()}] ${linea}`
  console.log(conFecha)
  try { appendFileSync(cfg.logFile, conFecha + '\n', 'utf8') } catch { /* logging es best-effort */ }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// dd/MM/yyyy — el único formato de fecha que acepta GetApiLiveQueryData
// (probado: yyyy-MM-dd tira "not recognized as a valid DateTime").
function ddMMyyyy(d) {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

// "2022-03-04T00:00:00" → "2022-03-04"
function soloFecha(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : ''
}

function recortarComprobante(fila) {
  return {
    tipo:               String(fila.TIPO_COMPROBANTE ?? ''),
    numero:             String(fila.NRO_COMPROBANTE ?? ''),
    fechaEmision:       soloFecha(fila.FECHA_DE_EMISION),
    ...(fila.FECHA_DE_VENCIMIENTO ? { fechaVencimiento: soloFecha(fila.FECHA_DE_VENCIMIENTO) } : {}),
    importeOriginal:    Number(fila.IMPORTE_AL_VENCIMIENTO_CTE ?? 0),
    saldoPendiente:     Number(fila.IMPORTE_PENDIENTE_CTE ?? 0),
    ...(typeof fila.ID_GVA12 === 'number' ? { idComprobanteTango: fila.ID_GVA12 } : {}),
    ...(typeof fila.DIAS_DE_ATRASO === 'number' && fila.DIAS_DE_ATRASO > 0 ? { diasAtraso: fila.DIAS_DE_ATRASO } : {}),
  }
}

// "ACH082 - HANZA MARIA ELENA" → { codigo: 'ACH082', nombre: 'HANZA MARIA ELENA' }
function parseCliente(campo) {
  const s = String(campo ?? '')
  const idx = s.indexOf(' - ')
  if (idx === -1) return { codigo: '', nombre: s }
  return { codigo: s.slice(0, idx).trim(), nombre: s.slice(idx + 3).trim() }
}

async function traerConsultaLive(proceso, etiqueta) {
  const desde = cfg.fromDate ?? '01/01/2015'
  const hastaDate = new Date()
  hastaDate.setFullYear(hastaDate.getFullYear() + 5)   // "a vencer" incluye vencimientos futuros
  const hasta = cfg.toDate ?? ddMMyyyy(hastaDate)

  const todos = []
  let pageIndex = 0
  let totalPages = 1
  do {
    const uri = cfg.tangoBaseUrl + '/Api/GetApiLiveQueryData'
      + '?process=' + proceso
      + '&customQuery=0'
      + '&fromDate=' + encodeURIComponent(desde)
      + '&toDate=' + encodeURIComponent(hasta)
      + '&pageSize=' + (cfg.pageSize ?? 500)
      + '&pageIndex=' + pageIndex
    const resp = await fetch(uri, {
      headers: { ApiAuthorization: cfg.tangoToken, Company: cfg.tangoCompany },
    })
    if (!resp.ok) throw new Error(`Tango respondió ${resp.status} en ${etiqueta} página ${pageIndex}`)
    const data = await resp.json()
    if (!data.succeeded) throw new Error(`Tango succeeded=false en ${etiqueta} página ${pageIndex}: ${data.exceptionInfo?.messages?.join('; ') ?? data.message ?? ''}`)

    totalPages = data.resultData.totalPages
    todos.push(...data.resultData.list)
    log(`  ${etiqueta}: página ${pageIndex + 1}/${totalPages} — ${todos.length} filas acumuladas`)
    pageIndex++
    await sleep(200)
  } while (pageIndex < totalPages)

  return todos
}

async function traerSaldosTango() {
  const filas = []
  filas.push(...await traerConsultaLive(cfg.procesoDeudasVencidas, 'deudas vencidas'))
  if (cfg.procesoDeudasAVencer) {
    filas.push(...await traerConsultaLive(cfg.procesoDeudasAVencer, 'deudas a vencer'))
  } else {
    log('  AVISO: procesoDeudasAVencer sin configurar — el cache solo va a tener las deudas YA VENCIDAS')
  }

  const porCliente = new Map()
  for (const fila of filas) {
    const idGva14 = fila.ID_GVA14
    if (typeof idGva14 !== 'number') continue
    if (!porCliente.has(idGva14)) {
      const { codigo, nombre } = parseCliente(fila.CLIENTE)
      porCliente.set(idGva14, {
        idGva14,
        codGva14:     codigo || undefined,
        razonSocial:  nombre || undefined,
        empresa:      cfg.empresa ?? 'redonhielo',
        comprobantes: [],
      })
    }
    porCliente.get(idGva14).comprobantes.push(recortarComprobante(fila))
  }
  return [...porCliente.values()]
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function postearLote(body, intento = 1) {
  try {
    const resp = await fetch(cfg.cloudFunctionUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.bridgeSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(data)}`)
    return data
  } catch (err) {
    if (intento >= 3) throw err
    const espera = [2000, 5000, 10000][intento - 1]
    log(`  lote falló (intento ${intento}): ${err.message} — reintentando en ${espera}ms`)
    await sleep(espera)
    return postearLote(body, intento + 1)
  }
}

async function main() {
  log(`Iniciando sync de saldos${DRY_RUN ? ' (DRY RUN — no escribe nada)' : ''}...`)

  const clientes = await traerSaldosTango()
  log(`Tango: ${clientes.length} clientes con deuda, posteando en lotes de 100...`)

  // runId identifica esta corrida completa: la Function vacía (saldo 0) los
  // docs del cache que no fueron tocados por este runId cuando llega el
  // último lote — clientes que ya no deben nada.
  const runId = new Date().toISOString()
  const lotes = chunk(clientes, 100)
  let chunksOk = 0, chunksFallidos = 0
  let actualizados = 0, skippedNoMatch = 0, vaciados = 0

  for (const [i, lote] of lotes.entries()) {
    const esUltimoLote = i === lotes.length - 1
    try {
      const resultado = await postearLote({ rows: lote, runId, esUltimoLote: esUltimoLote && chunksFallidos === 0, dryRun: DRY_RUN })
      if (resultado.succeeded === false) {
        log(`  lote ${i + 1}/${lotes.length}: sync deshabilitado o rechazado — ${resultado.reason}`)
        chunksFallidos++
        continue
      }
      actualizados += resultado.actualizados ?? 0
      skippedNoMatch += resultado.skippedNoMatch ?? 0
      vaciados += resultado.vaciados ?? 0
      chunksOk++
      log(`  lote ${i + 1}/${lotes.length} OK — ${resultado.actualizados} actualizados${esUltimoLote ? `, ${resultado.vaciados ?? 0} vaciados (sin deuda)` : ''}`)
    } catch (err) {
      // Si un lote falló, NO se manda esUltimoLote en los siguientes: el
      // snapshot quedó incompleto y el vaciado borraría deuda real.
      chunksFallidos++
      log(`  lote ${i + 1}/${lotes.length} FALLÓ definitivamente: ${err.message}`)
    }
  }

  if (clientes.length === 0 && !DRY_RUN) {
    // Nadie debe nada: igual hay que vaciar el cache viejo.
    try {
      const resultado = await postearLote({ rows: [], runId, esUltimoLote: true, dryRun: false })
      vaciados += resultado.vaciados ?? 0
      chunksOk++
    } catch (err) {
      chunksFallidos++
      log(`  vaciado final FALLÓ: ${err.message}`)
    }
  }

  log(`Resumen: ${chunksOk} lotes OK, ${chunksFallidos} fallidos — actualizados=${actualizados} sinCuentaEnApp=${skippedNoMatch} vaciados=${vaciados}`)
  process.exit(chunksFallidos > 0 ? 1 : 0)
}

main().catch((err) => {
  log(`ERROR FATAL: ${err.stack ?? err.message}`)
  process.exit(1)
})
