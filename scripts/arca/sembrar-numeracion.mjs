/**
 * sembrar-numeracion.mjs
 *
 * Crea en Firestore los contadores de numeración de un punto de venta, con el
 * último número que ARCA tiene autorizado para cada tipo de comprobante.
 *
 * Hace falta UNA VEZ por punto de venta antes de la primera factura: la
 * numeración la lleva el emisor, no ARCA, y `reservarNumero` se niega a inventar
 * un número si no sabe de dónde arranca ("mejor no facturar que facturar con un
 * número que ya usó otro"). Sin esto, la primera venta falla y la reconciliación
 * la reintenta cada hora sin que nada cambie nunca.
 *
 * Solo LEE de ARCA (`FECompUltimoAutorizado`): no emite ningún comprobante.
 * Y es idempotente — si el contador ya existe, lo respeta y no lo pisa: pisarlo
 * sería el camino más corto a numerar dos veces el mismo comprobante.
 *
 * Uso:
 *   ARCA_CERT=C:\ruta\cert.crt ARCA_KEY=C:\ruta\clave.key \
 *   ARCA_CUIT=30697668973 ARCA_PTO_VTA=1104 ARCA_AMBIENTE=produccion \
 *   node scripts/arca/sembrar-numeracion.mjs
 *
 * ARCA_AMBIENTE por defecto es "homologacion", igual que el resto de los
 * scripts: para tocar producción hay que pedirlo explícitamente.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const lib       = path.join(__dirname, '..', '..', 'functions', 'lib', 'services', 'arca')

const admin = require('../../functions/node_modules/firebase-admin/lib/index.js')

const { generarTRA, firmarTRA, parsearRespuestaWsaa, WSAA_URL } = require(path.join(lib, 'wsaa.js'))
const { MARGEN_RENOVACION_MS: MARGEN_MS } = require(path.join(lib, 'ticketCache.js'))
const { feCompUltimoAutorizado } = require(path.join(lib, 'wsfev1.js'))
const { fetchArca } = require(path.join(lib, 'httpArca.js'))
const { inicializarContador, rutaContador } = require(path.join(lib, 'numeracion.js'))
const { TIPO_COMPROBANTE } = require(path.join(lib, 'comprobante.js'))

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json')
const SALIDA_DIR = path.join(__dirname, 'salida')

const AMBIENTE = process.env.ARCA_AMBIENTE ?? 'homologacion'
const CERT     = process.env.ARCA_CERT
const KEY      = process.env.ARCA_KEY
const CUIT     = process.env.ARCA_CUIT
const PTO_VTA  = Number(process.env.ARCA_PTO_VTA ?? 1)

// Los que emite la venta de calle: A para responsables inscriptos, B para
// consumidor final. C no aplica — el emisor es responsable inscripto.
const TIPOS = [
  { cbteTipo: TIPO_COMPROBANTE.FACTURA_A, nombre: 'Factura A' },
  { cbteTipo: TIPO_COMPROBANTE.FACTURA_B, nombre: 'Factura B' },
]

if (!CERT || !KEY || !CUIT) {
  console.error('Faltan variables: ARCA_CERT, ARCA_KEY, ARCA_CUIT (y opcionalmente ARCA_PTO_VTA).')
  process.exit(1)
}

async function obtenerTicket() {
  mkdirSync(SALIDA_DIR, { recursive: true })
  // ARCA entrega UN SOLO ticket válido por vez para cada certificado+servicio:
  // se comparte el cache con verificar-conexion.mjs para poder correr los dos
  // seguidos sin que el segundo choque con "ya posee un TA valido".
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

  const resp = await fetchArca(WSAA_URL[AMBIENTE], {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: sobre,
  })
  const ta = parsearRespuestaWsaa(await resp.text())
  writeFileSync(cache, JSON.stringify({
    token: ta.token, sign: ta.sign, expiracion: ta.expiracion.toISOString(),
  }, null, 2), 'utf8')
  console.log(`Ticket de acceso nuevo, vence ${ta.expiracion.toISOString()}`)
  return { token: ta.token, sign: ta.sign, cuit: CUIT }
}

async function main() {
  console.log(`Ambiente: ${AMBIENTE.toUpperCase()}   CUIT: ${CUIT}   Punto de venta: ${PTO_VTA}`)
  console.log('Este script SOLO LEE de ARCA: no emite ningún comprobante.\n')

  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const firestore = admin.firestore()

  // La forma mínima que esperan los servicios de arca/.
  const db = {
    doc: (ruta) => firestore.doc(ruta),
    runTransaction: (fn) => firestore.runTransaction(fn),
  }

  const cfg = { ambiente: AMBIENTE, credenciales: await obtenerTicket() }

  for (const { cbteTipo, nombre } of TIPOS) {
    const ruta = rutaContador({ ptoVta: PTO_VTA, cbteTipo })
    const previo = await firestore.doc(ruta).get()

    const estado = await inicializarContador(
      db,
      { ptoVta: PTO_VTA, cbteTipo },
      () => feCompUltimoAutorizado(cfg, PTO_VTA, cbteTipo),
    )

    const marca = previo.exists ? 'YA EXISTÍA, no se tocó' : 'sembrado'
    console.log(
      `${nombre.padEnd(10)} ${ruta.padEnd(34)} último=${String(estado.ultimoAsignado).padStart(6)}  ` +
      `→ el próximo será el ${estado.ultimoAsignado + 1}   (${marca})`,
    )
  }

  console.log('\nListo. La primera factura de cada tipo va a salir con el número siguiente.')
  process.exit(0)
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
