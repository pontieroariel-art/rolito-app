/**
 * verificar-conexion.mjs
 *
 * Diagnóstico de SOLO LECTURA contra ARCA. Sirve para confirmar, antes de
 * emitir nada, que:
 *   1. La infraestructura de ARCA responde        (FEDummy, sin autenticación)
 *   2. El certificado está habilitado para "wsfe" (WSAA devuelve un TA)
 *   3. El punto de venta existe y está activo     (FECompUltimoAutorizado)
 *
 * NO emite comprobantes. No llama a FECAESolicitar. Se puede correr contra
 * producción sin efecto fiscal: lo único que hace es leer.
 *
 * Las credenciales NUNCA se pasan por el repo. Se leen de variables de entorno
 * con la ruta a los archivos:
 *
 *   ARCA_CERT=C:\ruta\al\certificado.crt \
 *   ARCA_KEY=C:\ruta\a\la\clave.key \
 *   ARCA_CUIT=30697668973 \
 *   ARCA_PTO_VTA=1104 \
 *   ARCA_AMBIENTE=produccion \
 *   node scripts/arca/verificar-conexion.mjs
 *
 * ARCA_AMBIENTE por defecto es "homologacion" a propósito: para pegarle a
 * producción hay que pedirlo explícitamente.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const lib       = path.join(__dirname, '..', '..', 'functions', 'lib', 'services', 'arca')

const { generarTRA, firmarTRA, parsearRespuestaWsaa, WSAA_URL } = require(path.join(lib, 'wsaa.js'))
// Mismo margen que usa la Cloud Function, para no tener dos criterios distintos
// sobre cuándo un ticket está "por vencer".
const { MARGEN_RENOVACION_MS: MARGEN_MS } = require(path.join(lib, 'ticketCache.js'))
const {
  feDummy, feCompUltimoAutorizado,
  feParamGetTiposTributos, feParamGetTiposIva, feParamGetPtosVenta,
  feParamGetCondicionIvaReceptor,
} = require(path.join(lib, 'wsfev1.js'))
const { TIPO_COMPROBANTE } = require(path.join(lib, 'comprobante.js'))

// Acá va el cache del Ticket de Acceso. Está gitignoreado: el token y la firma
// permiten operar ante ARCA en nombre del CUIT.
const SALIDA_DIR = path.join(__dirname, 'salida')

const AMBIENTE = process.env.ARCA_AMBIENTE ?? 'homologacion'
const CERT     = process.env.ARCA_CERT
const KEY      = process.env.ARCA_KEY
const CUIT     = process.env.ARCA_CUIT
const PTO_VTA  = Number(process.env.ARCA_PTO_VTA ?? 0)

if (!CERT || !KEY || !CUIT) {
  console.error('Faltan variables: ARCA_CERT, ARCA_KEY, ARCA_CUIT (y opcionalmente ARCA_PTO_VTA).')
  process.exit(1)
}

// Se prepara acá, en el arranque, y no en el medio del diagnóstico: si la ruta
// falla conviene enterarse antes de gastar una llamada a ARCA.
mkdirSync(SALIDA_DIR, { recursive: true })
const cacheTa = path.join(SALIDA_DIR, `ta-${AMBIENTE}-${CUIT}.json`)

// El transporte HTTP es el MISMO que usa la Cloud Function (httpArca.ts), no
// una copia: así este diagnóstico ejercita el código real, incluido el manejo
// del TLS particular de ARCA. Ver el encabezado de ese archivo.
const { fetchArca } = require(path.join(lib, 'httpArca.js'))

const ok   = (m) => console.log(`  OK    ${m}`)
const fail = (m) => console.log(`  FALLA ${m}`)

async function main() {
  console.log(`Ambiente: ${AMBIENTE.toUpperCase()}   CUIT: ${CUIT}   Punto de venta: ${PTO_VTA || '(no informado)'}`)
  console.log('Este script SOLO LEE: no emite ningún comprobante.\n')

  const credencialesVacias = { token: '', sign: '', cuit: CUIT }
  const cfgBase = { ambiente: AMBIENTE, fetchImpl: fetchArca }

  // 1. Infraestructura (no requiere autenticación)
  console.log('1. Infraestructura de ARCA (FEDummy)')
  try {
    const d = await feDummy({ ...cfgBase, credenciales: credencialesVacias })
    ok(`app=${d.appServer} db=${d.dbServer} auth=${d.authServer}`)
  } catch (e) {
    fail(e.message)
    console.log('\n   Si esto falla, el problema es de red o de ARCA, no de nuestras credenciales.')
    process.exit(1)
  }

  // 2. Autenticación
  //
  // Se cachea el Ticket de Acceso en un archivo: ARCA entrega UNO SOLO válido
  // por vez para cada certificado+servicio, y dura 12 h. Sin cache, la segunda
  // corrida del script en el mismo día falla con "ya posee un TA valido" — que
  // no es un problema, pero impide seguir diagnosticando. Es el mismo motivo
  // por el que la Cloud Function cachea en Firestore (ver ticketCache.ts).
  console.log('\n2. Certificado habilitado para "wsfe" (WSAA)')

  let ta = null
  if (existsSync(cacheTa)) {
    try {
      const guardado = JSON.parse(readFileSync(cacheTa, 'utf8'))
      const vence = new Date(guardado.expiracion)
      if (vence.getTime() - MARGEN_MS > Date.now()) {
        ta = { token: guardado.token, sign: guardado.sign, expiracion: vence }
        ok(`Ticket de acceso reutilizado del cache, vence ${vence.toISOString()}`)
      }
    } catch { /* cache corrupto: se pide uno nuevo */ }
  }

  if (!ta) try {
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
    ta = parsearRespuestaWsaa(await resp.text())
    writeFileSync(cacheTa, JSON.stringify({
      token: ta.token, sign: ta.sign, expiracion: ta.expiracion.toISOString(),
    }, null, 2), 'utf8')
    ok(`Ticket de acceso obtenido, vence ${ta.expiracion.toISOString()}`)
  } catch (e) {
    fail(e.message)

    if (/ya posee un TA valido/i.test(e.message)) {
      console.log('\n   No es un problema de credenciales: ya hay un ticket vigente para este')
      console.log('   certificado y servicio, y ARCA entrega uno solo por vez (dura 12 h).')
      console.log(`   Normalmente lo resuelve el cache (${path.basename(cacheTa)}); si llegaste acá`)
      console.log('   es porque el cache se borró o el ticket lo pidió otro sistema.')
      console.log('   Si nadie más usa este certificado, esperá a que venza.')
    }

    if (/no autorizado a acceder al servicio/i.test(e.message)) {
      console.log('\n   El certificado existe y la firma es válida, pero NO está asociado al')
      console.log('   servicio "wsfe" (Facturación Electrónica). Son dos trámites distintos:')
      console.log('   generar el certificado es uno, autorizarlo a un servicio es otro.')
      console.log('')
      if (AMBIENTE === 'homologacion') {
        console.log('   En HOMOLOGACIÓN se hace desde el autogestión de ARCA (WSASS),')
        console.log('   creando una "autorización a servicio" que vincule este certificado')
        console.log('   con "wsfe" y con el CUIT representado.')
      } else {
        console.log('   En PRODUCCIÓN se hace desde Clave Fiscal → Administrador de Relaciones,')
        console.log('   asociando el certificado (Computador Fiscal) al servicio de')
        console.log('   Facturación Electrónica.')
      }
      console.log('')
      console.log(`   Verificá también que el CUIT informado (${CUIT}) sea el del certificado:`)
      console.log('   el de homologación suele salir a nombre de una persona física, no de la empresa.')
    }

    process.exit(1)
  }

  // 3. Punto de venta (lectura pura)
  if (PTO_VTA) {
    console.log(`\n3. Punto de venta ${PTO_VTA} (FECompUltimoAutorizado)`)
    const cfg = { ...cfgBase, credenciales: { token: ta.token, sign: ta.sign, cuit: CUIT } }
    for (const [nombre, tipo] of [
      ['Factura A', TIPO_COMPROBANTE.FACTURA_A],
      ['Factura B', TIPO_COMPROBANTE.FACTURA_B],
    ]) {
      try {
        const ultimo = await feCompUltimoAutorizado(cfg, PTO_VTA, tipo)
        ok(`${nombre}: último autorizado = ${ultimo}  →  el próximo sería el ${ultimo + 1}`)
      } catch (e) {
        fail(`${nombre}: ${e.message}`)
      }
    }
  }

  // 4. Tablas de referencia (lectura pura). Son la fuente autoritativa de los
  //    códigos: hardcodearlos a ojo es cómo se informa mal un comprobante.
  const cfg = { ...cfgBase, credenciales: { token: ta.token, sign: ta.sign, cuit: CUIT } }

  console.log('\n4. Tablas de referencia de ARCA')

  const tabla = async (titulo, fn, filtro = () => true) => {
    try {
      const items = await fn(cfg)
      console.log(`\n   -- ${titulo}`)
      for (const i of items.filter(filtro)) {
        console.log(`      ${String(i.id ?? i.nro).padStart(4)}  ${i.desc ?? `emision=${i.emisionTipo} bloqueado=${i.bloqueado}`}`)
      }
    } catch (e) {
      console.log(`\n   -- ${titulo}: FALLA ${e.message}`)
      // 602 en la lista de puntos de venta es lo NORMAL en homologación: el
      // ambiente de prueba no trae ninguno dado de alta. No impide emitir —
      // hay que probar un número concreto con FECompUltimoAutorizado.
      if (/602/.test(e.message) && /PtosVenta/.test(titulo + e.message)) {
        console.log('      (En homologación es lo esperado: el ambiente no trae puntos de venta')
        console.log('       dados de alta. Probá uno concreto pasando ARCA_PTO_VTA=1, y si el')
        console.log('       paso 3 responde en vez de fallar, ese punto de venta sirve.)')
      }
    }
  }

  // La que más importa hoy: de acá sale el Id para informar la percepción de
  // IIBB de CABA en <Tributos>.
  await tabla('Tipos de TRIBUTO (para percepciones de IIBB)', feParamGetTiposTributos)
  await tabla('Alícuotas de IVA', feParamGetTiposIva)
  await tabla('Condición IVA del receptor', feParamGetCondicionIvaReceptor)
  await tabla('Puntos de venta habilitados', feParamGetPtosVenta)

  console.log('\nVerificación terminada. No se emitió ningún comprobante.')
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
