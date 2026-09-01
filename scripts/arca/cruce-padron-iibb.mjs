/**
 * cruce-padron-iibb.mjs
 *
 * Cruza el padrón de regímenes generales de IIBB de CABA (AGIP) contra los
 * clientes de la app, para saber a cuántos hay que percibirles y con qué
 * alícuota.
 *
 * Redonhielo es agente de percepción de IIBB de CABA: mes a mes AGIP publica un
 * padrón con la alícuota que le corresponde a cada CUIT, y ese archivo se
 * importa en Tango. Este script NO reemplaza esa importación — sirve para
 * dimensionar el impacto y, sobre todo, para **validar** que la alícuota que
 * nos devuelve el ABM de Tango coincide con la del padrón.
 *
 * Formato del archivo (delimitado por `;`, sin encabezado, encoding latin1):
 *
 *   1  fecha de publicación   ddmmaaaa
 *   2  vigencia desde         ddmmaaaa
 *   3  vigencia hasta         ddmmaaaa
 *   4  CUIT                   11 dígitos
 *   5  tipo de contribuyente  D = directo/local, C = convenio multilateral
 *   6  marca                  S/N
 *   7  marca                  S/N
 *   8  alícuota de PERCEPCIÓN  con coma decimal
 *   9  alícuota de RETENCIÓN   con coma decimal
 *   10 grupo percepción
 *   11 grupo retención
 *   12 razón social / apellido y nombre
 *
 * OJO con los campos 8 y 9: en la mayoría de los registros coinciden, pero NO
 * siempre (en la corrida del padrón 08/2026, 156 de nuestros clientes tenían
 * percepción distinta de retención). Confundirlos factura mal. La asignación de
 * arriba sigue el layout publicado por AGIP y debe confirmarse contra lo que
 * Tango tiene cargado para un mismo CUIT.
 *
 * Uso:
 *   node scripts/arca/cruce-padron-iibb.mjs <ruta-al-padron.TXT>
 */

import { readFileSync, createReadStream, writeFileSync, mkdirSync } from 'fs'
import readline from 'readline'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json')
const SALIDA_DIR           = path.join(__dirname, 'salida')

const PADRON = process.argv[2]
if (!PADRON) {
  console.error('Uso: node scripts/arca/cruce-padron-iibb.mjs <ruta-al-padron.TXT>')
  console.error('(el archivo viene comprimido de AGIP; hay que descomprimirlo antes)')
  process.exit(1)
}

/** ddmmaaaa -> Date */
function fechaPadron(s) {
  if (!/^\d{8}$/.test(s ?? '')) return null
  return new Date(Number(s.slice(4)), Number(s.slice(2, 4)) - 1, Number(s.slice(0, 2)))
}

const aNumero = (s) => parseFloat(String(s ?? '0').replace(',', '.')) || 0

async function main() {
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()

  const snap = await db.collection('users').where('rol', '==', 'cliente').get()
  const porCuit = new Map()
  snap.forEach((d) => {
    const u = d.data()
    const cuit = String(u.cuit ?? '').replace(/\D/g, '')
    if (cuit.length === 11) {
      porCuit.set(cuit, { uid: d.id, razonSocial: u.razonSocial ?? '', codigoTango: u.codigoTango ?? '' })
    }
  })
  console.log(`Clientes de la app con CUIT: ${porCuit.size}`)

  const rl = readline.createInterface({
    input: createReadStream(PADRON, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  })

  let total = 0
  let vigenciaDesde = null
  let vigenciaHasta = null
  const encontrados = []

  for await (const linea of rl) {
    if (!linea.trim()) continue
    total++
    const p = linea.split(';')
    if (!vigenciaDesde) {
      vigenciaDesde = fechaPadron(p[1])
      vigenciaHasta = fechaPadron(p[2])
    }
    const cli = porCuit.get(p[3])
    if (!cli) continue

    encontrados.push({
      ...cli,
      cuit: p[3],
      tipoContribuyente: p[4],
      alicuotaPercepcion: aNumero(p[7]),
      alicuotaRetencion: aNumero(p[8]),
      razonSocialPadron: (p[11] ?? '').trim(),
    })
  }

  const conPercepcion = encontrados.filter((e) => e.alicuotaPercepcion > 0)
  const difieren = encontrados.filter((e) => e.alicuotaPercepcion !== e.alicuotaRetencion)

  const fmt = (d) => (d ? d.toISOString().slice(0, 10) : '?')
  const hoy = new Date()
  const vencido = vigenciaHasta && hoy > vigenciaHasta

  console.log(`\nPadrón: ${total.toLocaleString()} registros`)
  console.log(`Vigencia: ${fmt(vigenciaDesde)} → ${fmt(vigenciaHasta)}${vencido ? '   *** VENCIDO ***' : ''}`)
  if (vencido) {
    console.log('  Este padrón ya no está vigente. Facturar con estas alícuotas sería incorrecto:')
    console.log('  hay que bajar el del mes en curso desde AGIP.')
  }

  console.log(`\nClientes nuestros en el padrón: ${encontrados.length}`)
  console.log(`  con alícuota de percepción > 0: ${conPercepcion.length}   <-- hay que percibirles`)
  console.log(`  con percepción distinta de retención: ${difieren.length}`)

  const porTasa = {}
  for (const e of encontrados) {
    const k = e.alicuotaPercepcion.toFixed(2)
    porTasa[k] = (porTasa[k] ?? 0) + 1
  }
  console.log('\nDistribución de alícuotas de percepción:')
  for (const [t, n] of Object.entries(porTasa).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
    console.log(`  ${t.padStart(6)}%  ${String(n).padStart(4)} clientes`)
  }

  mkdirSync(SALIDA_DIR, { recursive: true })
  const salida = path.join(SALIDA_DIR, 'padron-iibb-clientes.json')
  writeFileSync(salida, JSON.stringify({
    padron: path.basename(PADRON),
    vigenciaDesde: fmt(vigenciaDesde),
    vigenciaHasta: fmt(vigenciaHasta),
    vencido,
    clientes: encontrados,
  }, null, 2), 'utf8')

  console.log(`\nDetalle: ${salida}`)
  console.log('(gitignoreado: tiene CUIT y razón social reales)')
  process.exit(0)
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
