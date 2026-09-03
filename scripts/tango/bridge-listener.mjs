/**
 * bridge-listener.mjs
 *
 * Corre EN LA VM de Tango (misma red que bridge-sync-clientes.mjs), pero como
 * SERVICIO DE WINDOWS persistente (ver NSSM más abajo), no como tarea diaria:
 * escucha tango-outbox en tiempo real y manda cada novedad a Tango apenas se
 * carga en la app (producción, remitos, recibos de cobranza), y responde las
 * consultas on-demand de tango-consultas (composición de saldos de un cliente
 * puntual, para la pantalla de cobro del supervisor).
 * Ver docs/tango/INTEGRACION.md §7.
 *
 * A diferencia de bridge-sync-clientes.mjs (que solo usa fetch, sin
 * dependencias), este script necesita el SDK cliente de Firestore para poder
 * escuchar cambios en tiempo real (onSnapshot) — no hay forma liviana de
 * hacer eso con fetch suelto. Usa el SDK CLIENTE (firebase/*), nunca
 * firebase-admin: la cuenta con la que se loguea (ver setup-bridge-account.mjs)
 * está acotada por firestore.rules a leer/actualizar tango-outbox y
 * tango-consultas y nada más — este script nunca tiene la clave maestra de
 * Firestore.
 *
 * Uso:
 *   1. En esta carpeta: npm install firebase (una vez, deja node_modules acá).
 *   2. Copiar este archivo + bridge-listener.config.json (basado en
 *      bridge-listener.config.example.json, con los valores reales) a la VM.
 *   3. Correr la cuenta de servicio una vez (ver setup-bridge-account.mjs).
 *   4. Probar a mano: node bridge-listener.mjs
 *   5. Instalar como servicio de Windows con NSSM (https://nssm.cc/), para
 *      que quede corriendo siempre y se reinicie solo si se cae:
 *        nssm install RolitoTangoListener "C:\ruta\a\node.exe" "C:\RolitoSync\bridge-listener.mjs"
 *        nssm set RolitoTangoListener AppDirectory C:\RolitoSync
 *        nssm start RolitoTangoListener
 *
 * Contra el emulador local (para probar el flujo end-to-end sin tocar
 * producción — ver CLAUDE.md):
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *     node scripts/tango/bridge-listener.mjs
 */

import { readFileSync, appendFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, updateDoc,
  collection, query, where, onSnapshot, serverTimestamp,
} from 'firebase/firestore'
import { armarPedido, renglonesDeVenta, referenciaPedido, prop, idDeFila } from './tango-pedido.mjs'
import { armarComprobanteFacturador, interpretarRespuestaFacturador } from './tango-factura.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, 'bridge-listener.config.json')
const MAX_INTENTOS = 5
const SWEEP_INTERVAL_MS = 5 * 60 * 1000   // barrido de seguridad cada 5 min
const HEARTBEAT_INTERVAL_MS = 60 * 1000
// Una consulta de saldo que quedó 'pendiente' más de esto ya no le sirve a
// nadie (la UI cae al cache a los ~12s) — el barrido la marca como error.
const CONSULTA_TIMEOUT_MS = 10 * 60 * 1000

function cargarConfig() {
  let cfg
  try {
    const texto = readFileSync(CONFIG_PATH, 'utf8')
    cfg = JSON.parse(texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto)
  } catch {
    console.error(`No se pudo leer ${CONFIG_PATH}. Copiá bridge-listener.config.example.json a bridge-listener.config.json y completá los valores reales.`)
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

async function flagTango(db, campo) {
  try {
    const snap = await getDoc(doc(db, 'config/tango'))
    return snap.data()?.[campo] === true
  } catch {
    return false
  }
}

/**
 * El header `Company` de la API, resuelto en el momento de mandar.
 *
 * El item del outbox dice a qué empresa del NEGOCIO pertenece
 * (`redonhielo` / `rolito`); el número sale de `config/tango.companies`:
 *
 *   { "redonhielo": 4, "rolito": 4 }   ← todo a TestingRH mientras se prueba
 *   { "redonhielo": 1, "rolito": 3 }   ← producción
 *
 * Así el pase de pruebas a producción es cambiar un doc de Firestore, sin
 * tocar código ni redeployar. Y si no está configurado NO se adivina: mandar
 * un comprobante a la empresa equivocada se limpia a mano del otro lado.
 */
async function resolverCompany(db, empresa) {
  if (!empresa) return { ok: false, error: 'El item no dice a qué empresa va (falta `empresa`)' }
  let companies
  try {
    const snap = await getDoc(doc(db, 'config/tango'))
    companies = snap.data()?.companies
  } catch (e) {
    return { ok: false, error: `No se pudo leer config/tango: ${e.message}` }
  }
  const company = companies?.[empresa]
  if (!Number.isInteger(company)) {
    return {
      ok: false,
      error: `config/tango.companies no tiene un número para "${empresa}". ` +
             'Cargalo antes de mandar nada (ej. {"redonhielo":4,"rolito":4} para TestingRH).',
    }
  }
  return { ok: true, company }
}

// ── Writers hacia Tango — STUBS pendientes de confirmar ─────────────────────
// No sabemos todavía qué pantalla/proceso usa el administrativo en Tango para
// cargar producción (¿ingreso de stock? ¿ajuste de stock? ¿orden de
// producción?), ni si está expuesto por la misma API ABM que ya usamos para
// Clientes (process=2117) o si requiere otro módulo. Hasta confirmar eso con
// Ariel/Axoft/TC Servicios (ver docs/tango/INTEGRACION.md §7), esta función
// solo loguea lo que MANDARÍA y devuelve un error controlado — no inventa un
// endpoint que todavía no confirmamos que existe.
async function enviarProduccionATango(payload) {
  log(`  [STUB] enviarProduccionATango — payload que se mandaría: ${JSON.stringify(payload)}`)
  return {
    ok: false,
    error: 'Proceso Tango para producción todavía no confirmado — ver docs/tango/INTEGRACION.md §7',
  }
}

// ── API de Ventas (Pedidos, process 19845) — cliente HTTP ───────────────────
// Misma superficie que la API de Plataforma (host interno, headers
// ApiAuthorization + Company). Config en bridge-listener.config.json:
//   "tangoVentas": { "baseUrl", "token", "procesos": {...}, "filtros": {...} }
// baseUrl/token caen a tangoSaldos si no están. Ver INTEGRACION.md §6.2 y §14.
function tangoVentasCfg() {
  const v = cfg.tangoVentas ?? {}
  const s = cfg.tangoSaldos ?? {}
  return {
    baseUrl: (v.baseUrl ?? s.baseUrl ?? '').replace(/\/+$/, ''),
    token:   v.token ?? s.token,
    procesos: { pedidos: 19845, articulos: 87, depositos: 2941, monedas: 1660, ...(v.procesos ?? {}) },
    // Plantillas de filtroSql (sintaxis de los ejemplos oficiales; ajustables
    // sin tocar código si la vista real usa otro nombre de columna).
    // Sintaxis confirmada contra el Tango real (2026-09-03): el filtroSql va
    // con "WHERE " adelante y el nombre de la vista/tabla como prefijo.
    filtros: {
      articulo:  "WHERE AXV_ARTICULO.COD_STA11 = '{cod}'",
      deposito:  "WHERE STA22.COD_STA22 = '{cod}'",
      moneda:    "WHERE MONEDA.COD_MONEDA = '{cod}'",
      pedidoRef: "WHERE AXV_PEDIDO.LEYENDA_1 = '{ref}'",
      ...(v.filtros ?? {}),
    },
    monedaCodigo:    v.monedaCodigo ?? 'PES',
    timeoutMs:       v.timeoutMs ?? 30_000,
  }
}

async function tangoRequest(company, metodo, accion, params, body) {
  const t = tangoVentasCfg()
  if (!t.baseUrl || !t.token) throw new Error('tangoVentas.baseUrl/token no configurados en bridge-listener.config.json')
  const qs = Object.entries(params ?? {}).map(([k, v]) => `${k}=${encodeURIComponent(v ?? '')}`).join('&')
  const uri = `${t.baseUrl}/Api/${accion}${qs ? '?' + qs : ''}`
  const resp = await fetch(uri, {
    method: metodo,
    headers: { ApiAuthorization: t.token, Company: String(company), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(t.timeoutMs),
  })
  const texto = await resp.text()
  let data
  try { data = texto ? JSON.parse(texto) : {} } catch { throw new Error(`Tango respondió ${resp.status} con cuerpo no JSON en ${accion}: ${texto.slice(0, 200)}`) }
  if (!resp.ok) throw new Error(`Tango respondió ${resp.status} en ${accion}: ${prop(data, 'message') ?? texto.slice(0, 200)}`)
  const ok = prop(data, 'succeeded')
  if (ok === false) {
    const info = prop(data, 'exceptionInfo')
    const msgs = prop(info, 'messages')
    throw new Error(`Tango succeeded=false en ${accion}: ${(Array.isArray(msgs) ? msgs.join('; ') : null) ?? prop(data, 'message') ?? JSON.stringify(data).slice(0, 300)}`)
  }
  return data
}

function filasDe(data) {
  const rd = prop(data, 'resultData')
  const lista = prop(rd, 'list') ?? (Array.isArray(rd) ? rd : null) ?? prop(data, 'list')
  return Array.isArray(lista) ? lista : []
}

// Cache de IDs internos por empresa (artículos, depósitos, moneda): son datos
// maestros, cambian casi nunca; se reinician al reiniciar el servicio.
const cacheIds = new Map()
async function resolverId(company, clave, proceso, filtroSql, campoId) {
  const k = `${company}|${clave}`
  if (cacheIds.has(k)) return cacheIds.get(k)
  const data = await tangoRequest(company, 'GET', 'GetByFilter', { process: proceso, view: '', filtroSql })
  const filas = filasDe(data)
  if (filas.length === 0) return null
  if (filas.length > 1) log(`  aviso: ${clave} devolvió ${filas.length} filas en Tango (filtro ${filtroSql}); se usa la primera`)
  const id = idDeFila(filas[0], campoId)
  if (id === undefined) return null
  cacheIds.set(k, id)
  return id
}

// Venta del camión (o de ventanilla) que NO factura ARCA: entra en Tango como
// PEDIDO en la empresa que diga el item, con el depósito del camión y el
// número del remito de la app como referencia. Ver tango-pedido.mjs.
//
// Idempotencia: LEYENDA_1 = 'ROLITO:VC:<ventaId>'. Antes de crear se busca un
// pedido con esa referencia (cubre "Create OK → el bridge murió antes de
// confirmar → el barrido reintenta"). Si la búsqueda falla (nombre de columna
// distinto en AXV_PEDIDO) se loguea y se sigue: mismo riesgo que hoy.
async function enviarRemitoATango(payload, item) {
  const t = tangoVentasCfg()
  const company = item.company
  const db = item.db

  // 1. Mapeos de la app (config/tango): productoId → COD_STA11, camionId → COD_STA22.
  let tangoCfg
  try { tangoCfg = (await getDoc(doc(db, 'config/tango'))).data() ?? {} } catch (e) { return { ok: false, error: `No se pudo leer config/tango: ${e.message}` } }
  const articulos = tangoCfg.articulos ?? {}
  const depositos = tangoCfg.depositos ?? {}
  const pedidoCfg = tangoCfg.pedido ?? {}

  const idGva14 = Number(payload.clienteIdGva14Tango)
  if (!Number.isInteger(idGva14) || idGva14 <= 0) {
    return { ok: false, error: `La venta no trae clienteIdGva14Tango (cliente ${payload.clienteId} sin vincular a Tango — corré el cruce por CUIT)` }
  }

  const { renglones, faltantes } = renglonesDeVenta(payload, (productoId) => articulos[productoId] ?? null)
  if (faltantes.length) {
    return { ok: false, error: `Falta el código de artículo Tango en config/tango.articulos para: ${faltantes.join(', ')}` }
  }
  if (renglones.length === 0) return { ok: false, error: 'La venta no tiene renglones con cantidad > 0' }

  // En Tango los depósitos son POR REPARTIDOR (03 SERGIO ALVAREZ, 04 BRIAN
  // GALLO…), no por patente: se busca primero por chofer y después por camión.
  const codDeposito = depositos[payload.choferId] ?? (payload.camionId ? depositos[payload.camionId] : null) ?? null
  if (!codDeposito) {
    return { ok: false, error: `Falta el depósito Tango del chofer ${payload.choferNombre ?? payload.choferId} (config/tango.depositos.${payload.choferId}) — los depósitos de Tango son por repartidor` }
  }

  try {
    // 2. IDs internos de Tango.
    const idMoneda = await resolverId(company, `moneda:${t.monedaCodigo}`, t.procesos.monedas, t.filtros.moneda.replace('{cod}', t.monedaCodigo), 'ID_MONEDA')
    if (idMoneda == null) return { ok: false, error: `Tango no devolvió la moneda ${t.monedaCodigo} (process ${t.procesos.monedas})` }

    let idDeposito = null
    if (codDeposito) {
      idDeposito = await resolverId(company, `deposito:${codDeposito}`, t.procesos.depositos, t.filtros.deposito.replace('{cod}', codDeposito), 'ID_STA22')
      if (idDeposito == null) return { ok: false, error: `Tango no tiene el depósito ${codDeposito} (camión ${payload.camionId}) en la empresa ${company}` }
    }

    const idsArticulos = {}
    for (const cod of new Set(renglones.map((r) => r.codigoArticulo))) {
      const id = await resolverId(company, `articulo:${cod}`, t.procesos.articulos, t.filtros.articulo.replace('{cod}', cod), 'ID_STA11')
      if (id == null) return { ok: false, error: `Tango no tiene el artículo ${cod} en la empresa ${company}` }
      idsArticulos[cod] = id
    }

    // 3. Idempotencia: ¿ya existe un pedido con esta referencia?
    const ref = referenciaPedido(item.origenColeccion, item.origenId)
    try {
      const previo = filasDe(await tangoRequest(company, 'GET', 'GetByFilter', {
        process: t.procesos.pedidos, view: '', filtroSql: t.filtros.pedidoRef.replace('{ref}', ref),
      }))
      if (previo.length > 0) {
        const savedId = idDeFila(previo[0], 'ID_GVA21')
        const nro = prop(previo[0], 'NRO_PEDIDO', 'N_PEDIDO', 'NUMERO')
        log(`  ${ref}: ya existía en Tango como pedido ${nro ?? savedId} — no se duplica`)
        return { ok: true, resultado: { savedId, pedidoNumero: nro ?? null, remitoNumero: String(nro ?? savedId), yaExistia: true } }
      }
    } catch (e) {
      log(`  aviso: no se pudo verificar duplicado (${e.message}); se crea igual`)
    }

    // 4. Crear el pedido.
    const pedido = armarPedido(payload, item, {
      idGva14, idMoneda, idDeposito, articulos: idsArticulos,
      talonarioId: pedidoCfg.talonarioId ?? null,
      vendedorId: pedidoCfg.vendedorId ?? null,
      condicionVentaId: pedidoCfg.condicionVentaId ?? null,
      listaPreciosId: pedidoCfg.listaPreciosId?.[payload.canal] ?? null,
    }, renglones, {
      estadoPedido: pedidoCfg.estado ?? 2,
      comprometeStock: pedidoCfg.comprometeStock ?? true,
      etiquetaCamion: `${codDeposito ?? ''} ${tangoCfg.camiones?.[payload.camionId] ?? ''}`.trim() || payload.camionId,
    })
    const creado = await tangoRequest(company, 'POST', 'Create', { process: t.procesos.pedidos }, pedido)
    const savedId = prop(creado, 'savedId')
    if (savedId == null) return { ok: false, error: `Tango no devolvió SavedId al crear el pedido: ${JSON.stringify(creado).slice(0, 300)}` }

    // 5. Número de pedido para el write-back (best-effort: el Create solo da el ID).
    let pedidoNumero = null
    try {
      // GetById devuelve { value: {...} } (confirmado 2026-09-03), no resultData.
      const det = await tangoRequest(company, 'GET', 'GetById', { process: t.procesos.pedidos, view: '', id: savedId })
      const fila = prop(det, 'value') ?? prop(det, 'resultData') ?? det
      pedidoNumero = prop(fila, 'NRO_PEDIDO', 'N_PEDIDO', 'NUMERO') ?? null
    } catch (e) {
      log(`  aviso: no se pudo leer el número del pedido ${savedId} (${e.message})`)
    }
    log(`  ${ref}: pedido creado en Tango (Company ${company}) id=${savedId} nro=${pedidoNumero ?? '?'}`)
    return { ok: true, resultado: { savedId, pedidoNumero, remitoNumero: String(pedidoNumero ?? savedId) } }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// Factura de venta del camión.
//
// ⚠️ LO MÁS IMPORTANTE DE TODA LA INTEGRACIÓN: cuando `item.conCaePropio` es
// true, la factura **YA FUE AUTORIZADA POR ARCA** — la emitió esta app, con su
// punto de venta 1104, y el CAE viaja en `payload.factura`. Tango tiene que
// registrarla como comprobante ya emitido, respetando ese punto de venta,
// número y CAE.
//
// Si el writer usara un proceso que le pide a ARCA un CAE propio, la MISMA
// operación quedaría autorizada dos veces: dos comprobantes fiscales por una
// sola venta, que después hay que anular con notas de crédito. Antes de
// completar esta función hay que confirmar con Axoft que la API admite
// registrar un comprobante con CAE externo. Si no lo admite, hay que replantear
// quién factura — no completar esto igual.
//
// Datos que ya vienen en el payload: `factura.puntoVenta`, `factura.numero`,
// `factura.cbteTipo` (1 = A, 6 = B), `factura.cae`, `factura.caeFchVto` y
// `factura.importes` (neto, iva, tributos, total) TAL COMO se le informaron a
// ARCA — no se recalculan de este lado.
// RESPONDIDO por la doc oficial del Facturador (2026-09-03, INTEGRACION.md §12
// y §15): el endpoint `POST /FacturadorVenta/registrar` acepta `cAE` +
// `fechaVtoCAE` puestos por quien llama (ejemplo "05 - Comprobante
// Electrónico") — Tango registra el comprobante YA autorizado, no pide CAE
// propio. Los importes viajan tal como se informaron a ARCA; los ítems se
// reconstruyen y se ajustan por redondeo para cerrar contra esos totales
// (tango-factura.mjs). Idempotencia natural: si el número ya está registrado,
// Tango responde (51016) y se toma como confirmado.
async function enviarFacturaATango(payload, item) {
  const t = tangoVentasCfg()
  const company = item.company
  const db = item.db

  let tangoCfg
  try { tangoCfg = (await getDoc(doc(db, 'config/tango'))).data() ?? {} } catch (e) { return { ok: false, error: `No se pudo leer config/tango: ${e.message}` } }
  const cfgEmpresa = tangoCfg.facturador?.[item.empresa]
  if (!cfgEmpresa) return { ok: false, error: `Falta config/tango.facturador.${item.empresa} (talonarios, condicionVenta, listaPrecio, contracuenta, vendedor, codigoTasaIva21, cuentas, codigoAlicuotaPercepcionIIBB)` }

  const articulos = tangoCfg.articulos ?? {}
  // Depósito por repartidor (ver enviarRemitoATango); ventanilla usa el suyo.
  const codigoDeposito = tangoCfg.depositos?.[payload.choferId]
    ?? (payload.camionId ? tangoCfg.depositos?.[payload.camionId] : null)
    ?? (!payload.camionId ? cfgEmpresa.depositoVentanilla : null)
    ?? null
  if (!codigoDeposito) {
    return { ok: false, error: payload.camionId ? `Falta el depósito Tango del chofer ${payload.choferNombre ?? payload.choferId} (config/tango.depositos.${payload.choferId})` : `Falta config/tango.facturador.${item.empresa}.depositoVentanilla` }
  }

  const armado = armarComprobanteFacturador(payload, item, cfgEmpresa, {
    codigoArticulo: (productoId) => articulos[productoId] ?? null,
    codigoDeposito,
    etiquetaCamion: `${codigoDeposito} ${tangoCfg.camiones?.[payload.camionId] ?? ''}`.trim(),
  })
  if (armado.error) return { ok: false, error: armado.error }

  // Seguridad: una venta marcada conCaePropio TIENE que llevar el CAE. Si no
  // lo trae, algo se desincronizó entre ARCA y el outbox — no se registra.
  if (item.conCaePropio === true && !armado.comprobante.cAE) {
    return { ok: false, error: 'El item dice conCaePropio pero la venta no trae factura.cae — no se registra sin CAE' }
  }

  const path = t.facturadorPath ?? '/FacturadorVenta/registrar'
  try {
    const uri = `${t.baseUrl}${path}`
    const resp = await fetch(uri, {
      method: 'POST',
      headers: { ApiAuthorization: t.token, Company: String(company), 'Content-Type': 'application/json' },
      body: JSON.stringify([armado.comprobante]),
      signal: AbortSignal.timeout(t.timeoutMs),
    })
    const texto = await resp.text()
    let data
    try { data = texto ? JSON.parse(texto) : {} } catch { return { ok: false, error: `Facturador respondió ${resp.status} con cuerpo no JSON: ${texto.slice(0, 200)}` } }
    if (!resp.ok && !data.Comprobantes && !data.comprobantes) return { ok: false, error: `Facturador respondió ${resp.status}: ${prop(data, 'message') ?? texto.slice(0, 200)}` }

    const r = interpretarRespuestaFacturador(data, armado.comprobante.numeroComprobante)
    if (!r.ok) return { ok: false, error: `Facturador rechazó ${armado.comprobante.numeroComprobante}: ${r.mensaje || JSON.stringify(data).slice(0, 300)}` }
    log(`  ${armado.referencia}: factura ${armado.comprobante.numeroComprobante} ${r.yaExistia ? 'ya estaba registrada' : 'registrada'} en Tango (Company ${company})${armado.comprobante.cAE ? ' con CAE ' + armado.comprobante.cAE : ' sin CAE'}`)
    return { ok: true, resultado: { facturaNumero: armado.comprobante.numeroComprobante, comprobanteNumero: r.numeroComprobante ?? armado.comprobante.numeroComprobante, yaExistia: r.yaExistia, fiscal: armado.fiscal } }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// Recibo de cobranza del supervisor. Cuando la licencia habilite transacciones
// y se releve el process de recibos, acá va el writer real — OBLIGATORIO con
// mitigación de duplicados: (1) GetByFilter previo buscando la referencia
// idempotente `ROLITO:{cobranzaId}` que viaja en el payload (cubre "Create OK
// → el bridge murió antes de confirmar → el barrido reintenta"); (2) persistir
// resultado.savedId en el outbox inmediatamente después del Create.
async function enviarReciboATango(payload) {
  log(`  [STUB] enviarReciboATango — payload que se mandaría: ${JSON.stringify(payload)}`)
  return {
    ok: false,
    error: 'API de recibos de cobranza no habilitada todavía (Transacciones Tango Ventas: No) — ver docs/tango/INTEGRACION.md',
  }
}

// Transferencia entre depósitos: remito de carga (planta → camión) y descarga
// del camión (camión → planta). En Tango los camiones son depósitos (STA22).
// Falta confirmar con Axoft/TC qué proceso de la API mueve stock entre
// depósitos (¿está bajo 'ABMs y Consultas Live' o es transacción de Stock?) —
// ver docs/tango/INTEGRACION.md §13. Hasta entonces, stub: loguea y falla
// controlado; el item queda pendiente mientras transferenciasEnabled=false.
async function enviarTransferenciaATango(payload, item) {
  log(
    `  [STUB] enviarTransferenciaATango — Company ${item?.company ?? '?'} (${item?.empresa ?? '?'}), ` +
    `sentido=${payload?.sentido}, payload: ${JSON.stringify(payload)}`,
  )
  return {
    ok: false,
    error: 'Proceso Tango para transferencias entre depósitos todavía no confirmado — ver docs/tango/INTEGRACION.md §13',
  }
}

// ── Dispatcher por entidad ──────────────────────────────────────────────────
// Cada entidad del outbox tiene su writer y su interruptor propio en
// config/tango — así se puede habilitar producción sin habilitar recibos, etc.
const HANDLERS = {
  produccionPallet: { enviar: enviarProduccionATango, flag: 'produccionEnabled' },
  remito:           { enviar: enviarRemitoATango,     flag: 'remitosEnabled' },
  factura:          { enviar: enviarFacturaATango,    flag: 'facturasEnabled' },
  recibo:           { enviar: enviarReciboATango,     flag: 'recibosEnabled' },
  transferenciaDeposito: { enviar: enviarTransferenciaATango, flag: 'transferenciasEnabled' },
}

const enProceso = new Set()

async function procesarItem(db, docId, data) {
  if (enProceso.has(docId)) return
  enProceso.add(docId)
  try {
    const handler = HANDLERS[data.entidad]
    if (!handler) {
      log(`  ${docId}: entidad desconocida "${data.entidad}", se deja pendiente`)
      return
    }
    if (!(await flagTango(db, handler.flag))) {
      log(`  ${docId}: config/tango.${handler.flag}=false, se deja pendiente (lo retoma el barrido)`)
      return
    }

    await updateDoc(doc(db, 'tango-outbox', docId), {
      estado: 'enviado',
      intentos: (data.intentos ?? 0) + 1,
      actualizadoEn: serverTimestamp(),
    })

    // Las ventas dicen a qué empresa van; producción y recibos todavía no
    // (siguen yendo a la empresa que tenga configurada el bridge).
    let company
    if (data.empresa) {
      const r = await resolverCompany(db, data.empresa)
      if (!r.ok) {
        log(`  ${docId}: ${r.error}`)
        await updateDoc(doc(db, 'tango-outbox', docId), {
          ultimoError: r.error, actualizadoEn: serverTimestamp(),
        })
        return
      }
      company = r.company
    }

    // Se le pasa el item entero más la empresa ya resuelta: el writer necesita
    // el header Company y saber si el comprobante ya trae CAE propio.
    const resultado = await handler.enviar(data.payload, { ...data, company, db })

    if (resultado.ok) {
      await updateDoc(doc(db, 'tango-outbox', docId), {
        estado: 'confirmado', ultimoError: null, actualizadoEn: serverTimestamp(),
        ...(resultado.resultado ? { resultado: resultado.resultado } : {}),
      })
      log(`  ${docId}: confirmado en Tango`)
    } else {
      const intentos = (data.intentos ?? 0) + 1
      // OJO: NO se vuelve a 'pendiente' acá — el listener en tiempo real
      // escucha justo estado=='pendiente', así que reponerlo dispararía un
      // reintento instantáneo (sin backoff) y quemaría MAX_INTENTOS en
      // milisegundos. 'enviado' queda fuera de ese query; el único que
      // reintenta un item en 'enviado' es el barrido cada 5 min — eso ES el
      // backoff.
      const estadoFinal = intentos >= MAX_INTENTOS ? 'error' : 'enviado'
      await updateDoc(doc(db, 'tango-outbox', docId), {
        estado: estadoFinal, ultimoError: resultado.error, actualizadoEn: serverTimestamp(),
      })
      log(`  ${docId}: falló (intento ${intentos}/${MAX_INTENTOS}) — ${resultado.error}`)
    }
  } catch (err) {
    log(`  ${docId}: ERROR inesperado procesando — ${err.message}`)
  } finally {
    enProceso.delete(docId)
  }
}

// ── Consultas on-demand (tango-consultas): composición de saldos ────────────
// La pantalla de cobro del supervisor crea un doc pidiendo el saldo fresco de
// UN cliente; acá se consultan las Live de "Deudas vencidas" + "Deudas a
// vencer" y se filtra por ID_GVA14, escribiendo el resultado en el MISMO doc.
// Una Cloud Function (onConsultaRespondida) copia después el resultado al
// cache saldosTango — este script nunca escribe el cache directo, coherente
// con el modelo de confianza del outbox.
//
// Formato de la API Live confirmado 2026-08-31 (ver docs/tango/INTEGRACION.md
// §6.1bis y bridge-sync-saldos.mjs, que usa el mismo): query string,
// customQuery=0 obligatorio, fechas dd/MM/yyyy.
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

function ddMMyyyy(d) {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

async function traerDeudasLive(t, proceso, idGva14) {
  const hastaDate = new Date()
  hastaDate.setFullYear(hastaDate.getFullYear() + 5)
  const filas = []
  let pageIndex = 0
  let totalPages = 1
  do {
    const uri = t.baseUrl + '/Api/GetApiLiveQueryData'
      + '?process=' + proceso
      + '&customQuery=0'
      + '&fromDate=' + encodeURIComponent(t.fromDate ?? '01/01/2015')
      + '&toDate=' + encodeURIComponent(ddMMyyyy(hastaDate))
      + '&pageSize=' + (t.pageSize ?? 500)
      + '&pageIndex=' + pageIndex
    const resp = await fetch(uri, { headers: { ApiAuthorization: t.token, Company: t.company } })
    if (!resp.ok) throw new Error(`Tango respondió ${resp.status} (process ${proceso}, página ${pageIndex})`)
    const data = await resp.json()
    if (!data.succeeded) throw new Error(`Tango succeeded=false (process ${proceso}): ${data.exceptionInfo?.messages?.join('; ') ?? data.message ?? ''}`)
    // El filtro por cliente es client-side (customQuery es un flag, no un
    // filtro): se pagina todo y se queda con las filas del ID_GVA14 pedido.
    filas.push(...data.resultData.list.filter((f) => f.ID_GVA14 === idGva14))
    totalPages = data.resultData.totalPages
    pageIndex++
  } while (pageIndex < totalPages)
  return filas
}

async function consultarSaldoEnTango(idGva14) {
  const t = cfg.tangoSaldos
  if (!t || !t.procesoDeudasVencidas) {
    return { ok: false, error: 'tangoSaldos.procesoDeudasVencidas no configurado en bridge-listener.config.json' }
  }
  try {
    const id = Number(idGva14)
    const filas = await traerDeudasLive(t, t.procesoDeudasVencidas, id)
    if (t.procesoDeudasAVencer) {
      filas.push(...await traerDeudasLive(t, t.procesoDeudasAVencer, id))
    }
    const comprobantes = filas.map(recortarComprobante)
    const saldoTotal = Math.round(comprobantes.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100
    return { ok: true, resultado: { comprobantes, saldoTotal } }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function procesarConsulta(db, docId, data) {
  const clave = `consulta:${docId}`
  if (enProceso.has(clave)) return
  enProceso.add(clave)
  try {
    if (data.tipo !== 'saldoCliente') {
      await updateDoc(doc(db, 'tango-consultas', docId), {
        estado: 'error', ultimoError: `tipo de consulta desconocido: ${data.tipo}`, actualizadoEn: serverTimestamp(),
      })
      return
    }
    if (!(await flagTango(db, 'consultasEnabled'))) {
      // Se deja pendiente: la UI cae al cache sola; el barrido la vence a los 10 min.
      return
    }

    const resultado = await consultarSaldoEnTango(data.idGva14)

    if (resultado.ok) {
      await updateDoc(doc(db, 'tango-consultas', docId), {
        estado: 'respondida', resultado: resultado.resultado, ultimoError: null, actualizadoEn: serverTimestamp(),
      })
      log(`  consulta ${docId}: saldo de idGva14=${data.idGva14} respondido (${resultado.resultado.comprobantes.length} comprobantes)`)
    } else {
      // Una consulta fallida se marca error de una (sin reintentos): el
      // supervisor ya está mirando el cache; reintentar tarde no aporta.
      await updateDoc(doc(db, 'tango-consultas', docId), {
        estado: 'error', ultimoError: resultado.error, actualizadoEn: serverTimestamp(),
      })
      log(`  consulta ${docId}: falló — ${resultado.error}`)
    }
  } catch (err) {
    log(`  consulta ${docId}: ERROR inesperado — ${err.message}`)
  } finally {
    enProceso.delete(clave)
  }
}

// Reintenta 'pendiente' (red de seguridad por si el listener se perdió un
// evento, ej. el flag estaba en false cuando se creó el item) y 'enviado'
// (items que fallaron un intento — ver nota en procesarItem: este barrido
// cada 5 min ES el backoff de esos reintentos). También vence consultas
// viejas que quedaron pendientes.
async function barridoPendientes(db) {
  const q = query(collection(db, 'tango-outbox'), where('estado', 'in', ['pendiente', 'enviado']))
  const res = await getDocs(q)
  if (!res.empty) {
    log(`Barrido: ${res.size} item(s) pendientes/a reintentar en tango-outbox`)
    for (const d of res.docs) await procesarItem(db, d.id, d.data())
  }

  const qc = query(collection(db, 'tango-consultas'), where('estado', '==', 'pendiente'))
  const resC = await getDocs(qc)
  for (const d of resC.docs) {
    const creado = d.data().creadoEn?.toDate?.()
    if (creado && Date.now() - creado.getTime() > CONSULTA_TIMEOUT_MS) {
      await updateDoc(doc(db, 'tango-consultas', d.id), {
        estado: 'error', ultimoError: 'consulta vencida sin responder', actualizadoEn: serverTimestamp(),
      }).catch(() => {})
    } else {
      await procesarConsulta(db, d.id, d.data())
    }
  }
}

async function main() {
  const app = initializeApp(cfg.firebaseConfig)
  const auth = getAuth(app)
  const db = getFirestore(app)

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
    connectFirestoreEmulator(db, host, Number(port))
  }
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true })
  }

  log('Iniciando sesión como bridge...')
  await signInWithEmailAndPassword(auth, cfg.tangoBridgeEmail, cfg.tangoBridgePassword)
  log('Sesión OK. Escuchando tango-outbox y tango-consultas en tiempo real...')

  const q = query(collection(db, 'tango-outbox'), where('estado', '==', 'pendiente'))
  onSnapshot(q, (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type === 'added' || change.type === 'modified') {
        procesarItem(db, change.doc.id, change.doc.data())
      }
    }
  }, (err) => {
    log(`ERROR en el listener de tango-outbox (el SDK va a reintentar solo): ${err.message}`)
  })

  const qc = query(collection(db, 'tango-consultas'), where('estado', '==', 'pendiente'))
  onSnapshot(qc, (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type === 'added' || change.type === 'modified') {
        procesarConsulta(db, change.doc.id, change.doc.data())
      }
    }
  }, (err) => {
    log(`ERROR en el listener de tango-consultas (el SDK va a reintentar solo): ${err.message}`)
  })

  setInterval(() => { barridoPendientes(db).catch((err) => log(`ERROR en barrido: ${err.message}`)) }, SWEEP_INTERVAL_MS)

  setInterval(() => {
    updateDoc(doc(db, 'config/tango'), { bridgeListenerLastSeen: serverTimestamp() })
      .catch((err) => log(`ERROR escribiendo heartbeat: ${err.message}`))
  }, HEARTBEAT_INTERVAL_MS)
}

main().catch(async (err) => {
  log(`ERROR FATAL al arrancar: ${err.stack ?? err.message}`)
  await sleep(5000)
  process.exit(1)   // NSSM lo reinicia solo
})
