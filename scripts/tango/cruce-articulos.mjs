/**
 * cruce-articulos.mjs
 *
 * Empareja el catalogo de productos de la app (config/catalogo en Firestore)
 * contra los articulos de Tango (ID_STA11), igual que en su momento
 * cross-referencia-clientes.mjs emparejo los clientes por CUIT.
 *
 * Diferencia importante con el cruce de clientes: alla habia una clave dura
 * (el CUIT). Aca NO hay ninguna clave en comun -- hay que emparejar por
 * nombre, que es difuso. Por eso este script NO escribe nada: propone
 * candidatos ordenados por puntaje para que un humano confirme. El paso de
 * escritura es aplicar-articulo-tango.mjs, despues de la revision.
 *
 * Requisitos previos:
 *   1. Correr scripts/tango/export-tablas-tango.ps1 en el server de Tango.
 *   2. Copiar el articulos.json resultante a scripts/tango/tango-tablas/.
 *
 * Uso:
 *   node scripts/tango/cruce-articulos.mjs
 *   node scripts/tango/cruce-articulos.mjs ruta/al/articulos.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json')
const SALIDA_PATH          = path.join(__dirname, 'cruce-articulos-propuesta.json')

const RUTAS_ARTICULOS = [
  process.argv[2],
  path.join(__dirname, 'tango-tablas', 'articulos.json'),
  path.join(__dirname, 'articulos.json'),
].filter(Boolean)

// ── Normalizacion y puntaje ───────────────────────────────────────────────────

/** minusculas, sin acentos, sin puntuacion, espacios colapsados */
function normalizar(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Extrae la magnitud del producto (2kg, 10kg, 6 litros, 1 litro...).
 * Es la senal MAS fuerte del cruce: "bolsa 2kg" y "bolsa 10kg" comparten
 * todas las palabras y solo se distinguen por el numero, asi que un choque
 * de magnitud tiene que pesar mas que cualquier coincidencia de texto.
 */
function magnitud(texto) {
  const t = normalizar(texto)
  let m = t.match(/(\d+(?:\s*[.,]\s*\d+)?)\s*(kg|kilo|kilos|k)\b/)
  if (m) return { valor: parseFloat(m[1].replace(/\s|,/g, '.')), unidad: 'kg' }
  m = t.match(/(\d+(?:\s*[.,]\s*\d+)?)\s*(l|lt|lts|litro|litros)\b/)
  if (m) return { valor: parseFloat(m[1].replace(/\s|,/g, '.')), unidad: 'l' }
  return null
}

/** Familia del producto: separa hielo de agua de insumos. */
function familia(texto) {
  const t = normalizar(texto)
  if (/\banticorrosivo\b/.test(t))                 return 'anticorrosivo'
  if (/\bdesmineralizada|destilada\b/.test(t))     return 'agua_desmineralizada'
  if (/\bagua\b/.test(t))                          return 'agua'
  if (/\bbidon\b/.test(t))                         return 'bidon'
  if (/\bbarra\b/.test(t))                         return 'hielo_barra'
  if (/\bpicad/.test(t))                           return 'hielo_picado'
  if (/\bescama/.test(t))                          return 'hielo_escamas'
  if (/\bhielo\b/.test(t))                         return 'hielo_bolsa'
  return null
}

/** Palabras sin valor discriminante: aparecen en casi todos los nombres. */
const STOPWORDS = new Set(['de', 'x', 'en', 'la', 'el', 'por', 'con', 'unidad', 'unidades'])

function tokens(texto) {
  return normalizar(texto).split(' ').filter((t) => t && !STOPWORDS.has(t))
}

/**
 * Puntaje 0-100 entre un producto de la app y un articulo de Tango.
 * El criterio: la familia y la magnitud mandan; el solapamiento de palabras
 * desempata. Un choque de magnitud o de familia hunde el puntaje aunque el
 * texto se parezca mucho.
 */
function puntuar(appProd, artTango) {
  const textoTango = [artTango.DESCRIPCIO, artTango.SINONIMO].filter(Boolean).join(' ')
  const textoApp   = appProd.nombre

  const tA = tokens(textoApp)
  const tT = tokens(textoTango)
  if (tT.length === 0) return { score: 0, motivos: ['articulo sin descripcion'] }

  const setT = new Set(tT)
  const comunes = tA.filter((t) => setT.has(t))
  const solape = comunes.length / Math.max(tA.length, 1)

  let score = solape * 50
  const motivos = []
  if (comunes.length) motivos.push(`palabras: ${comunes.join(', ')}`)

  const famA = familia(textoApp)
  const famT = familia(textoTango)
  if (famA && famT) {
    if (famA === famT) { score += 30; motivos.push(`familia ${famA}`) }
    else               { score -= 35; motivos.push(`FAMILIA DISTINTA (${famA} vs ${famT})`) }
  }

  const magA = magnitud(textoApp)
  const magT = magnitud(textoTango)
  if (magA && magT) {
    if (magA.unidad === magT.unidad && magA.valor === magT.valor) {
      score += 25
      motivos.push(`magnitud ${magA.valor}${magA.unidad}`)
    } else {
      score -= 40
      motivos.push(`MAGNITUD DISTINTA (${magA.valor}${magA.unidad} vs ${magT.valor}${magT.unidad})`)
    }
  } else if (magA && !magT) {
    score -= 8
    motivos.push('el articulo de Tango no declara magnitud')
  }

  return { score: Math.max(0, Math.round(score)), motivos }
}

function nivelConfianza(mejor, segundo) {
  if (!mejor || mejor.score < 40) return 'SIN MATCH'
  const distancia = mejor.score - (segundo?.score ?? 0)
  if (mejor.score >= 75 && distancia >= 15) return 'ALTA'
  if (mejor.score >= 55) return 'MEDIA'
  return 'BAJA'
}

// ── Main ──────────────────────────────────────────────────────────────────────

function cargarArticulos() {
  const ruta = RUTAS_ARTICULOS.find((r) => existsSync(r))
  if (!ruta) {
    console.error('No encontre el export de articulos de Tango. Busque en:')
    RUTAS_ARTICULOS.forEach((r) => console.error('  - ' + r))
    console.error('\nCorre primero scripts/tango/export-tablas-tango.ps1 en el server de Tango')
    console.error('y copia el articulos.json resultante a scripts/tango/tango-tablas/.')
    process.exit(1)
  }
  const crudo = JSON.parse(readFileSync(ruta, 'utf8'))
  // El dump de PowerShell puede venir como array directo o envuelto.
  const lista = Array.isArray(crudo) ? crudo : (crudo.list ?? crudo.resultData?.list ?? [])
  console.log(`Articulos de Tango: ${lista.length}  (${ruta})`)
  return lista
}

async function main() {
  const articulos = cargarArticulos()

  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()

  const snap = await db.collection('config').doc('catalogo').get()
  const productos = (snap.data() ?? {}).productos ?? []
  console.log(`Productos de la app:  ${productos.length}\n`)

  const propuesta = []

  for (const prod of productos) {
    const candidatos = articulos
      .map((art) => {
        const { score, motivos } = puntuar(prod, art)
        return {
          score,
          motivos,
          idSta11:  art.ID_STA11,
          codSta11: art.COD_STA11,
          descripcion: art.DESCRIPCIO,
          sinonimo: art.SINONIMO,
          llevaStock: art.STOCK,
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)   // se muestran siempre, aunque punteen 0: en un SIN MATCH
                     // lo util es ver contra que se comparo, no una lista vacia

    const confianza = nivelConfianza(candidatos[0], candidatos[1])

    propuesta.push({
      productoId: prod.id,
      nombreApp:  prod.nombre,
      unidadApp:  prod.unidad,
      confianza,
      sugerido: confianza === 'SIN MATCH' ? null : {
        idSta11:  candidatos[0].idSta11,
        codSta11: candidatos[0].codSta11,
        descripcion: candidatos[0].descripcion,
      },
      candidatos,
    })

    const marca = { ALTA: 'OK ', MEDIA: '?? ', BAJA: '!! ', 'SIN MATCH': 'XX ' }[confianza]
    console.log(`${marca}${prod.nombre}  [${prod.id}]  -> ${confianza}`)
    if (candidatos.length === 0) {
      console.log('     sin candidatos')
    } else {
      for (const c of candidatos) {
        console.log(`     ${String(c.score).padStart(3)}  ${c.codSta11}  ${c.descripcion}`)
        console.log(`          ${c.motivos.join(' | ')}`)
      }
    }
    console.log('')
  }

  writeFileSync(SALIDA_PATH, JSON.stringify(propuesta, null, 2), 'utf8')

  const porNivel = propuesta.reduce((acc, p) => {
    acc[p.confianza] = (acc[p.confianza] ?? 0) + 1
    return acc
  }, {})

  console.log('===== RESUMEN =====')
  for (const [nivel, n] of Object.entries(porNivel)) console.log(`  ${nivel}: ${n}`)
  console.log(`\nPropuesta escrita en: ${SALIDA_PATH}`)
  console.log('Revisala (sobre todo los MEDIA/BAJA/SIN MATCH), corregi a mano el campo')
  console.log('"sugerido" donde haga falta, y recien despues corre el script de aplicacion.')

  process.exit(0)
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1) })
