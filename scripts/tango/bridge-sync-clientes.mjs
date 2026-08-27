/**
 * bridge-sync-clientes.mjs
 *
 * Corre EN LA VM de Tango (no en este repo, no en CI), programado con el
 * Task Scheduler de Windows. Trae los clientes de Tango (API de Plataforma,
 * process=2117) y se los manda en lotes a la Cloud Function `syncClientesTango`,
 * que es la única con la clave de Firestore — este script nunca la tiene.
 *
 * Uso:
 *   1. Copiar este archivo + un `bridge-sync-clientes.config.json` (basado en
 *      `bridge-sync-clientes.config.example.json`, con los valores reales) a
 *      una carpeta fija en la VM, ej. C:\RolitoSync\.
 *   2. Confirmar Node 22 instalado en la VM (`node -v`).
 *   3. Probar a mano primero: node bridge-sync-clientes.mjs --dry-run
 *   4. Programar en Task Scheduler: acción `node.exe C:\RolitoSync\bridge-sync-clientes.mjs`,
 *      "Run whether user is logged on or not", trigger diario (ej. 5am).
 */

import { readFileSync, appendFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, 'bridge-sync-clientes.config.json')
const DRY_RUN = process.argv.includes('--dry-run')

function cargarConfig() {
  let cfg
  try {
    const texto = readFileSync(CONFIG_PATH, 'utf8')
    // Si se guardó desde el Bloc de notas como "UTF-8", Windows a veces le agrega
    // un BOM invisible al principio del archivo que rompe JSON.parse — se ignora.
    cfg = JSON.parse(texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto)
  } catch (err) {
    console.error(`No se pudo leer ${CONFIG_PATH}. Copiá bridge-sync-clientes.config.example.json a bridge-sync-clientes.config.json y completá los valores reales.`)
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

// Mismo recorte de campos usado en export-clientes-tango.ps1/cross-referencia-clientes.mjs,
// más los campos adicionales que necesita el sync continuo (teléfonos, condición
// de venta, categoría IVA, vendedor, domicilio) — ver tangoSync.ts para el detalle
// de qué hace la Function con cada uno.
function recortarCliente(c) {
  return {
    idGva14:            c.ID_GVA14,
    codGva14:           c.COD_GVA14,
    cuit:               c.CUIT,
    razonSocial:        c.RAZON_SOCI,
    email:              c.E_MAIL,
    telefono1:          c.TELEFONO_1,
    telefono2:          c.TELEFONO_2,
    telefonoMovil:      c.TELEFONO_MOVIL,
    condicionVentaDesc: c.GVA01_DESC_COND,
    categoriaIvaCodigo: c.COD_CATEGORIA_IVA,
    categoriaIvaDesc:   c.DESC_CATEGORIA_IVA,
    vendedorCodigo:     c.GVA23_CODIGO,
    domicilio:          c.DOMICILIO || c.DIR_COM,
    localidad:          c.LOCALIDAD,
    provinciaDesc:      c.GVA18_DESCRIPCION,
    codigoPostal:       c.C_POSTAL,
    fechaAlta:          c.FECHA_ALTA,
  }
}

async function traerClientesTango() {
  const todos = []
  let pageIndex = 0
  let totalPages = 1

  do {
    const uri = cfg.tangoBaseUrl + '?process=' + cfg.tangoProcess + '&pageSize=' + cfg.pageSize + '&pageIndex=' + pageIndex + '&view='
    const resp = await fetch(uri, {
      headers: { ApiAuthorization: cfg.tangoToken, Company: cfg.tangoCompany },
    })
    if (!resp.ok) throw new Error(`Tango respondió ${resp.status} en la página ${pageIndex}`)
    const data = await resp.json()
    if (!data.succeeded) throw new Error(`Tango succeeded=false en la página ${pageIndex}: ${data.message ?? ''}`)

    totalPages = data.resultData.totalPages
    todos.push(...data.resultData.list.map(recortarCliente))
    log(`  página ${pageIndex + 1}/${totalPages} — ${todos.length} clientes acumulados`)
    pageIndex++
    await sleep(200)
  } while (pageIndex < totalPages)

  return todos
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function postearLote(lote, intento = 1) {
  try {
    const resp = await fetch(cfg.cloudFunctionUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.bridgeSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: lote, dryRun: DRY_RUN }),
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(data)}`)
    return data
  } catch (err) {
    if (intento >= 3) throw err
    const espera = [2000, 5000, 10000][intento - 1]
    log(`  lote falló (intento ${intento}): ${err.message} — reintentando en ${espera}ms`)
    await sleep(espera)
    return postearLote(lote, intento + 1)
  }
}

async function main() {
  log(`Iniciando sync${DRY_RUN ? ' (DRY RUN — no escribe nada)' : ''}...`)

  const clientes = await traerClientesTango()
  log(`Tango: ${clientes.length} clientes traídos, posteando en lotes de 300...`)

  const lotes = chunk(clientes, 300)
  let chunksOk = 0, chunksFallidos = 0
  const acumulado = { actualizados: 0, matchedByIdGva14: 0, matchedByCuit: 0, newlyLinkedCodigoTango: 0, skippedNoMatch: 0, skippedAmbiguousCuit: 0, emailsActualizados: 0, emailsConError: 0, errores: [] }

  for (const [i, lote] of lotes.entries()) {
    try {
      const resultado = await postearLote(lote)
      if (resultado.succeeded === false) {
        log(`  lote ${i + 1}/${lotes.length}: sync deshabilitado o rechazado — ${resultado.reason}`)
        chunksFallidos++
        continue
      }
      for (const clave of Object.keys(acumulado)) {
        if (clave === 'errores') acumulado.errores.push(...(resultado.errores ?? []))
        else acumulado[clave] += resultado[clave] ?? 0
      }
      chunksOk++
      log(`  lote ${i + 1}/${lotes.length} OK — ${resultado.actualizados} actualizados`)
    } catch (err) {
      chunksFallidos++
      log(`  lote ${i + 1}/${lotes.length} FALLÓ definitivamente: ${err.message}`)
    }
  }

  log(`Resumen: ${chunksOk} lotes OK, ${chunksFallidos} lotes fallidos.`)
  log(`  actualizados=${acumulado.actualizados} matchByIdGva14=${acumulado.matchedByIdGva14} matchByCuit=${acumulado.matchedByCuit} nuevosLink=${acumulado.newlyLinkedCodigoTango}`)
  log(`  skippedNoMatch=${acumulado.skippedNoMatch} skippedAmbiguo=${acumulado.skippedAmbiguousCuit} emailsActualizados=${acumulado.emailsActualizados} emailsConError=${acumulado.emailsConError}`)
  if (acumulado.errores.length > 0) {
    log(`  ${acumulado.errores.length} errores puntuales (primeros 10): ${JSON.stringify(acumulado.errores.slice(0, 10))}`)
  }

  process.exit(chunksFallidos > 0 ? 1 : 0)
}

main().catch((err) => {
  log(`ERROR FATAL: ${err.stack ?? err.message}`)
  process.exit(1)
})
