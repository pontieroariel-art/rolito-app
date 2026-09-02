/**
 * emitir-prueba.mjs
 *
 * Primera emisión de punta a punta contra ARCA. A diferencia de
 * verificar-conexion.mjs, este script SÍ EMITE: llama a FECAESolicitar y el
 * comprobante queda autorizado en el ambiente que se le indique.
 *
 * Ejercita la MISMA cadena de código que la Cloud Function (`emitirComprobante`
 * de functions/lib/services/arca/emision.js), no una copia: la validación del
 * receptor, el cálculo de IVA y percepción, la ventana de fechas, la reserva de
 * número y el armado del FECAEDetRequest son los de producción. Lo único que se
 * reemplaza es Firestore, por un contador en memoria — así la prueba no toca la
 * base ni pisa la numeración real.
 *
 * Después de emitir, vuelve a preguntarle a ARCA por ese comprobante
 * (FECompConsultar) para confirmar que quedó registrado del otro lado.
 *
 * Uso (homologación, sin efecto fiscal):
 *
 *   ARCA_CERT=C:\...\app_rolito_homo.crt \
 *   ARCA_KEY=C:\...\Privada_RedonhieloSA_AppRolito.key \
 *   ARCA_CUIT=20128494651 \
 *   ARCA_PTO_VTA=1 \
 *   node scripts/arca/emitir-prueba.mjs
 *
 * En PRODUCCIÓN cada comprobante emitido es real y solo se corrige con nota de
 * crédito, así que además de ARCA_AMBIENTE=produccion hay que pasar
 * ARCA_CONFIRMO_PRODUCCION=si. Sin esa segunda llave el script no arranca.
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
const { emitirComprobante } = require(path.join(lib, 'emision.js'))
const { inicializarContador } = require(path.join(lib, 'numeracion.js'))
const { TIPO_COMPROBANTE, TRIBUTO } = require(path.join(lib, 'comprobante.js'))

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

// Emitir en producción tiene efecto fiscal: no alcanza con pedir el ambiente.
if (AMBIENTE === 'produccion' && process.env.ARCA_CONFIRMO_PRODUCCION !== 'si') {
  console.error('ARCA_AMBIENTE=produccion emite comprobantes REALES.')
  console.error('Si es lo que querés, agregá ARCA_CONFIRMO_PRODUCCION=si.')
  process.exit(1)
}

// ── Firestore de mentira ─────────────────────────────────────────────────────
// `emitirComprobante` solo necesita doc() y runTransaction() para llevar el
// contador. Un objeto en memoria alcanza, y deja la prueba sin efectos
// colaterales: no hay base que ensuciar ni numeración real que consumir.
function dbEnMemoria() {
  const datos = new Map()
  const ref = (ruta) => ({ ruta })
  const snap = (ruta) => ({
    exists: datos.has(ruta),
    data: () => datos.get(ruta),
  })
  return {
    doc: (ruta) => ref(ruta),
    async runTransaction(fn) {
      return fn({
        get: async (r) => snap(r.ruta),
        set: (r, v) => datos.set(r.ruta, v),
        update: (r, v) => datos.set(r.ruta, { ...datos.get(r.ruta), ...v }),
      })
    },
    _datos: datos,
  }
}

async function obtenerTicket() {
  mkdirSync(SALIDA_DIR, { recursive: true })
  const cache = path.join(SALIDA_DIR, `ta-${AMBIENTE}-${CUIT}.json`)

  // ARCA entrega UN SOLO ticket válido por vez para cada certificado+servicio:
  // sin cache, correr esto después de verificar-conexion.mjs falla con
  // "ya posee un TA valido". Es el mismo archivo que usa ese script.
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

// ── Los comprobantes de prueba ───────────────────────────────────────────────
// Tres casos que recorren caminos distintos del código: la clase A, el tributo
// de percepción, y la clase B (que no lleva discriminado el IVA).
//
// El CUIT del receptor es 20-11111111-2, ficticio pero con dígito verificador
// válido: `validarReceptor` lo exige y en homologación ARCA no lo cruza contra
// el padrón real.
const CASOS = [
  {
    nombre: 'Factura A a Responsable Inscripto, sin percepción',
    receptor: { razonSocial: 'CLIENTE DE PRUEBA S.A.', cuit: '20111111112', categoriaIvaTango: 'RI' },
    items: [{ descripcion: 'HIELO EN BOLSA ROLITO 3 KG', cantidad: 10, precioUnitario: 2505.60 }],
    calculo: { preciosIncluyenIva: false },
  },
  {
    nombre: 'Factura A con percepción de IIBB CABA (tributo 7)',
    receptor: { razonSocial: 'CLIENTE DE PRUEBA S.A.', cuit: '20111111112', categoriaIvaTango: 'RI' },
    items: [{ descripcion: 'HIELO EN BOLSA ROLITO 3 KG', cantidad: 10, precioUnitario: 2505.60 }],
    calculo: {
      preciosIncluyenIva: false,
      percepcionIIBB: {
        alicuota: 2,
        // El código de tributo sale de config/arca.tributoIdPercepcionIIBB; acá
        // se pasa el mismo valor (7 = Percepción de IIBB) a mano.
        tributoId: TRIBUTO.PERCEPCION_IIBB,
        // Vigencia que cubre hoy: el cálculo rechaza una alícuota sin período,
        // porque sin él no hay forma de saber si el padrón está al día.
        vigenciaDesde: '2026-09-01',
        vigenciaHasta: '2026-09-30',
      },
    },
  },
  {
    nombre: 'Factura B a Consumidor Final',
    receptor: { razonSocial: 'CONSUMIDOR DE PRUEBA', cuit: '20111111112', categoriaIvaTango: 'CF' },
    items: [{ descripcion: 'HIELO EN BOLSA ROLITO 3 KG', cantidad: 2, precioUnitario: 2505.60 }],
    calculo: { preciosIncluyenIva: false },
  },
]

const money = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  console.log(`Ambiente: ${AMBIENTE.toUpperCase()}   CUIT emisor: ${CUIT}   Punto de venta: ${PTO_VTA}`)
  console.log(AMBIENTE === 'produccion'
    ? '*** ESTE SCRIPT EMITE COMPROBANTES REALES ***\n'
    : 'Homologación: los comprobantes que se emitan no tienen efecto fiscal.\n')

  const credenciales = await obtenerTicket()
  const cfg = { ambiente: AMBIENTE, credenciales, fetchImpl: fetchArca }

  // El puerto es la única pieza que este script arma: adentro, `emitirComprobante`
  // hace exactamente lo mismo que en la Cloud Function.
  const arca = {
    solicitarCae: (ptoVta, cbteTipo, detalle) => feCaeSolicitar(cfg, ptoVta, cbteTipo, detalle),
    consultarComprobante: (ptoVta, cbteTipo, numero) => feCompConsultar(cfg, ptoVta, cbteTipo, numero),
  }

  // Un solo contador para toda la corrida: así el segundo comprobante del mismo
  // tipo saca el número siguiente, como pasaría en la realidad.
  const db = dbEnMemoria()

  // La numeración la lleva el emisor, no ARCA, así que el contador arranca
  // preguntándole a ARCA cuál fue el último autorizado. Es lo mismo que hace la
  // Cloud Function la primera vez que factura con un punto de venta.
  for (const cbteTipo of [TIPO_COMPROBANTE.FACTURA_A, TIPO_COMPROBANTE.FACTURA_B]) {
    const estado = await inicializarContador(
      db,
      { ptoVta: PTO_VTA, cbteTipo },
      () => feCompUltimoAutorizado(cfg, PTO_VTA, cbteTipo),
    )
    console.log(`Contador tipo ${cbteTipo}: último autorizado en ARCA = ${estado.ultimoAsignado}`)
  }

  const emitidos = []

  for (const caso of CASOS) {
    console.log(`\n── ${caso.nombre}`)

    let resultado
    try {
      resultado = await emitirComprobante({
        db,
        arca,
        ptoVta: PTO_VTA,
        datos: {
          receptor: caso.receptor,
          items: caso.items,
          fechaVenta: new Date(),
          numeroComprobante: 0,   // lo asigna la reserva, este valor se ignora
        },
        calculo: caso.calculo,
        onNumeroReservado: async (numero, cbteTipo) => {
          console.log(`   número reservado: ${numero} (tipo ${cbteTipo})`)
        },
      })
    } catch (e) {
      console.log(`   ERROR antes de llegar a ARCA: ${e.message}`)
      continue
    }

    if (resultado.estado !== 'emitido') {
      console.log(`   ${resultado.estado.toUpperCase()}: ${resultado.motivo}`)
      continue
    }

    console.log(`   EMITIDO  ${String(PTO_VTA).padStart(5, '0')}-${String(resultado.numero).padStart(8, '0')}`)
    console.log(`   CAE ${resultado.cae}   vence ${resultado.caeFchVto}`)
    if (resultado.observaciones.length > 0) {
      for (const o of resultado.observaciones) console.log(`   observación [${o.code}] ${o.msg}`)
    }

    // La prueba de fuego: preguntarle a ARCA si de verdad lo tiene.
    const consulta = await arca.consultarComprobante(PTO_VTA, resultado.cbteTipo, resultado.numero)
    console.log(consulta.existe
      ? `   confirmado por ARCA: CAE ${consulta.cae}, total ${money(consulta.impTotal ?? 0)}`
      : '   ARCA NO lo reconoce (revisar antes de seguir)')

    emitidos.push({ caso: caso.nombre, ...resultado, consulta })
  }

  console.log(`\n${emitidos.length} de ${CASOS.length} comprobantes emitidos y confirmados.`)

  if (emitidos.length > 0) {
    const archivo = path.join(SALIDA_DIR, `emitidos-${AMBIENTE}.json`)
    writeFileSync(archivo, JSON.stringify(emitidos, null, 2), 'utf8')
    console.log(`Detalle en ${archivo}`)
  }
}

main().catch((e) => {
  console.error('\nFALLÓ:', e.message)
  process.exit(1)
})
