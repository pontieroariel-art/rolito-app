/**
 * emitir-nc-prueba.mjs
 *
 * Prueba de punta a punta de la NOTA DE CRÉDITO contra ARCA: emite una Factura
 * B de prueba y a continuación la NC B que la anula, con `CbtesAsoc` (tipo,
 * punto de venta, número, CUIT emisor y fecha del asociado), y reconsulta las
 * dos con FECompConsultar. Es la única forma de validar el XML de los
 * comprobantes asociados (la doc del repo no lo cubre): correrlo en
 * HOMOLOGACIÓN antes de deployar la anulación a producción.
 *
 * Ejercita la misma cadena que la Cloud Function (`emitirComprobante`,
 * `construirDetalleNotaCreditoTotal`, `emitirDetalle` de functions/lib), con un
 * contador en memoria en vez de Firestore.
 *
 * Uso (homologación, sin efecto fiscal):
 *
 *   ARCA_CERT=C:\...\app_rolito_homo.crt ARCA_KEY=C:\...\Privada_RedonhieloSA_AppRolito.key \
 *   ARCA_CUIT=20128494651 ARCA_PTO_VTA=1 node scripts/arca/emitir-nc-prueba.mjs
 *
 * En PRODUCCIÓN emite comprobantes REALES: exige ARCA_CONFIRMO_PRODUCCION=si.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const lib       = path.join(__dirname, '..', '..', 'functions', 'lib', 'services', 'arca')

const { generarTRA, firmarTRA, parsearRespuestaWsaa, WSAA_URL } = require(path.join(lib, 'wsaa.js'))
const { MARGEN_RENOVACION_MS: MARGEN_MS } = require(path.join(lib, 'ticketCache.js'))
const { feCaeSolicitar, feCompConsultar, feCompUltimoAutorizado } = require(path.join(lib, 'wsfev1.js'))
const { fetchArca } = require(path.join(lib, 'httpArca.js'))
const { emitirComprobante, emitirDetalle } = require(path.join(lib, 'emision.js'))
const { inicializarContador } = require(path.join(lib, 'numeracion.js'))
const { TIPO_COMPROBANTE, construirDetalleNotaCreditoTotal } = require(path.join(lib, 'comprobante.js'))

const SALIDA_DIR = path.join(__dirname, 'salida')
const AMBIENTE = process.env.ARCA_AMBIENTE ?? 'homologacion'
const CERT     = process.env.ARCA_CERT
const KEY      = process.env.ARCA_KEY
const CUIT     = process.env.ARCA_CUIT
const PTO_VTA  = Number(process.env.ARCA_PTO_VTA ?? 1)

if (!CERT || !KEY || !CUIT) {
  console.error('Faltan variables: ARCA_CERT, ARCA_KEY, ARCA_CUIT (y opcionalmente ARCA_PTO_VTA).')
  process.exit(1)
}
if (AMBIENTE === 'produccion' && process.env.ARCA_CONFIRMO_PRODUCCION !== 'si') {
  console.error('ARCA_AMBIENTE=produccion emite comprobantes REALES. Si es lo que querés, agregá ARCA_CONFIRMO_PRODUCCION=si.')
  process.exit(1)
}

function dbEnMemoria() {
  const datos = new Map()
  const ref = (ruta) => ({ ruta })
  const snap = (ruta) => ({ exists: datos.has(ruta), data: () => datos.get(ruta) })
  return {
    doc: (ruta) => ref(ruta),
    async runTransaction(fn) {
      return fn({
        get: async (r) => snap(r.ruta),
        set: (r, v) => datos.set(r.ruta, v),
        update: (r, v) => datos.set(r.ruta, { ...datos.get(r.ruta), ...v }),
      })
    },
  }
}

async function obtenerTicket() {
  mkdirSync(SALIDA_DIR, { recursive: true })
  const cache = path.join(SALIDA_DIR, `ta-${AMBIENTE}-${CUIT}.json`)
  if (existsSync(cache)) {
    try {
      const g = JSON.parse(readFileSync(cache, 'utf8'))
      const vence = new Date(g.expiracion)
      if (vence.getTime() - MARGEN_MS > Date.now()) {
        console.log(`Ticket de acceso del cache, vence ${vence.toISOString()}`)
        return { token: g.token, sign: g.sign, cuit: CUIT }
      }
    } catch { /* cache corrupto: se pide uno nuevo */ }
  }
  const tra = generarTRA('wsfe')
  const cms = firmarTRA(tra, readFileSync(CERT, 'utf8'), readFileSync(KEY, 'utf8'))
  const sobre = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
    '                  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">',
    '<soapenv:Header/><soapenv:Body><wsaa:loginCms>',
    `<wsaa:in0>${cms}</wsaa:in0>`,
    '</wsaa:loginCms></soapenv:Body></soapenv:Envelope>',
  ].join('')
  const resp = await fetchArca(WSAA_URL[AMBIENTE], { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' }, body: sobre })
  const ta = parsearRespuestaWsaa(await resp.text())
  writeFileSync(cache, JSON.stringify({ token: ta.token, sign: ta.sign, expiracion: ta.expiracion.toISOString() }, null, 2), 'utf8')
  console.log(`Ticket de acceso nuevo, vence ${ta.expiracion.toISOString()}`)
  return { token: ta.token, sign: ta.sign, cuit: CUIT }
}

const money = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  console.log(`Ambiente: ${AMBIENTE.toUpperCase()}   CUIT emisor: ${CUIT}   Punto de venta: ${PTO_VTA}\n`)
  const credenciales = await obtenerTicket()
  const cfg = { ambiente: AMBIENTE, credenciales, fetchImpl: fetchArca }
  const arca = {
    solicitarCae: (ptoVta, cbteTipo, detalle) => feCaeSolicitar(cfg, ptoVta, cbteTipo, detalle),
    consultarComprobante: (ptoVta, cbteTipo, numero) => feCompConsultar(cfg, ptoVta, cbteTipo, numero),
  }
  const db = dbEnMemoria()
  for (const cbteTipo of [TIPO_COMPROBANTE.FACTURA_B, TIPO_COMPROBANTE.NOTA_CREDITO_B]) {
    const estado = await inicializarContador(db, { ptoVta: PTO_VTA, cbteTipo }, () => feCompUltimoAutorizado(cfg, PTO_VTA, cbteTipo))
    console.log(`Contador tipo ${cbteTipo}: último autorizado en ARCA = ${estado.ultimoAsignado}`)
  }

  // 1. La factura a anular (B a consumidor final, $1 neto).
  console.log('\n── Factura B de prueba')
  const factura = await emitirComprobante({
    db, arca, ptoVta: PTO_VTA,
    datos: {
      receptor: { razonSocial: 'CONSUMIDOR DE PRUEBA', cuit: '20111111112', categoriaIvaTango: 'CF' },
      items: [{ descripcion: 'HIELO EN BOLSA ROLITO 3 KG', cantidad: 1, precioUnitario: 1 }],
      fechaVenta: new Date(), numeroComprobante: 0,
    },
    calculo: { preciosIncluyenIva: false },
  })
  if (factura.estado !== 'emitido') { console.log(`   ${factura.estado.toUpperCase()}: ${factura.motivo}`); process.exit(1) }
  console.log(`   EMITIDA ${String(PTO_VTA).padStart(5, '0')}-${String(factura.numero).padStart(8, '0')}  CAE ${factura.cae}  total ${money(factura.importes.total)}`)

  // 2. La nota de crédito, exactamente como la arma la Cloud Function.
  console.log('\n── Nota de crédito B que la anula (con CbtesAsoc)')
  const origen = { puntoVenta: PTO_VTA, cbteTipo: factura.cbteTipo, numero: factura.numero, importes: factura.importes, detalle: factura.detalle }
  const armar = (numero) => construirDetalleNotaCreditoTotal(origen, { numeroComprobante: numero, fechaEmision: new Date(), cuitEmisor: CUIT, tributoIdPercepcionIIBB: 7 })
  const { cbteTipo } = armar(1)
  const nc = await emitirDetalle({
    db, arca, ptoVta: PTO_VTA, cbteTipo,
    armarDetalle: (numero) => armar(numero).detalle,
    onNumeroReservado: async (numero) => console.log(`   número reservado: ${numero} (tipo ${cbteTipo})`),
  })
  if (nc.estado !== 'emitido') { console.log(`   ${nc.estado.toUpperCase()}: ${nc.motivo}`); process.exit(1) }
  console.log(`   EMITIDA ${String(PTO_VTA).padStart(5, '0')}-${String(nc.numero).padStart(8, '0')}  CAE ${nc.cae}  total ${money(nc.importes.total)}`)
  for (const o of nc.observaciones) console.log(`   observación [${o.code}] ${o.msg}`)

  const consulta = await arca.consultarComprobante(PTO_VTA, cbteTipo, nc.numero)
  console.log(consulta.existe
    ? `   confirmada por ARCA: CAE ${consulta.cae}, total ${money(consulta.impTotal ?? 0)}`
    : '   ARCA NO la reconoce (revisar antes de seguir)')

  const archivo = path.join(SALIDA_DIR, `nc-prueba-${AMBIENTE}.json`)
  writeFileSync(archivo, JSON.stringify({ factura, notaCredito: nc, consulta }, null, 2), 'utf8')
  console.log(`\nDetalle en ${archivo}`)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message); process.exit(1) })
