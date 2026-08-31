/**
 * bridge-sync-saldos.mjs
 *
 * Corre EN LA VM de Tango (no en este repo, no en CI), programado con el
 * Task Scheduler de Windows (cada 1-2 horas — más frecuente que el sync de
 * clientes: es el cache que ven los supervisores al cobrar). Trae la
 * composición de saldos de los clientes (facturas pendientes de cobro, con
 * saldo restante) y se la manda en lotes a la Cloud Function `syncSaldosTango`,
 * que es la única con la clave de Firestore — este script nunca la tiene.
 *
 * ⚠ El `process`/vista de la composición de saldos TODAVÍA NO ESTÁ RELEVADO
 * (ver docs/tango/INTEGRACION.md). Todo lo específico de Tango está
 * parametrizado en el config (`tangoProcess`, `tangoView`) y aislado en
 * `recortarComprobante()`/`agruparPorCliente()` — al relevar el contrato real
 * solo hay que ajustar esos nombres de campo.
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
  for (const [clave, valor] of Object.entries(cfg)) {
    if (typeof valor === 'string' && valor.includes('_AQUI')) {
      console.error(`Falta completar "${clave}" en ${CONFIG_PATH}.`)
      process.exit(1)
    }
  }
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

// ── Mapeo Tango → row de la Function ─────────────────────────────────────────
// Nombres de campo TENTATIVOS (estilo AXV_* clásico de Tango) — ajustar acá
// cuando se releve la vista real de composición de saldos. La Function
// (functions/src/triggers/tangoSaldos.ts) solo conoce el formato de salida de
// estas dos funciones, no el de Tango.
function recortarComprobante(c) {
  return {
    tipo:               c.T_COMP ?? c.TIPO_COMP ?? c.TIPO ?? '',
    numero:             c.N_COMP ?? c.NRO_COMP ?? c.NUMERO ?? '',
    fechaEmision:       c.FECHA_EMIS ?? c.FECHA ?? '',
    fechaVencimiento:   c.FECHA_VTO ?? undefined,
    importeOriginal:    Number(c.IMPORTE ?? c.TOTAL ?? 0),
    saldoPendiente:     Number(c.SALDO ?? c.IMPORTE_PENDIENTE ?? 0),
    idComprobanteTango: c.ID_GVA12 ?? c.ID_COMP ?? undefined,
  }
}

function agruparPorCliente(lista) {
  const porCliente = new Map()
  for (const fila of lista) {
    const idGva14 = fila.ID_GVA14 ?? fila.GVA14_ID
    if (typeof idGva14 !== 'number') continue
    if (!porCliente.has(idGva14)) {
      porCliente.set(idGva14, {
        idGva14,
        codGva14:     fila.COD_GVA14 ?? undefined,
        razonSocial:  fila.RAZON_SOCI ?? undefined,
        empresa:      cfg.empresa ?? 'redonhielo',
        comprobantes: [],
      })
    }
    porCliente.get(idGva14).comprobantes.push(recortarComprobante(fila))
  }
  return [...porCliente.values()]
}

async function traerSaldosTango() {
  const todos = []
  let pageIndex = 0
  let totalPages = 1

  do {
    const uri = cfg.tangoBaseUrl + '?process=' + cfg.tangoProcess + '&pageSize=' + cfg.pageSize + '&pageIndex=' + pageIndex + '&view=' + (cfg.tangoView ?? '')
    const resp = await fetch(uri, {
      headers: { ApiAuthorization: cfg.tangoToken, Company: cfg.tangoCompany },
    })
    if (!resp.ok) throw new Error(`Tango respondió ${resp.status} en la página ${pageIndex}`)
    const data = await resp.json()
    if (!data.succeeded) throw new Error(`Tango succeeded=false en la página ${pageIndex}: ${data.message ?? ''}`)

    totalPages = data.resultData.totalPages
    todos.push(...data.resultData.list)
    log(`  página ${pageIndex + 1}/${totalPages} — ${todos.length} filas acumuladas`)
    pageIndex++
    await sleep(200)
  } while (pageIndex < totalPages)

  return agruparPorCliente(todos)
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
