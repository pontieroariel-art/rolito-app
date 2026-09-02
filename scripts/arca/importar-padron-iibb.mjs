/**
 * importar-padron-iibb.mjs
 *
 * Completa `users/{uid}.percepcionIIBB` con la alícuota que AGIP publica cada
 * mes para cada CUIT. Es el dato que le falta a la facturación: sin él la app
 * emite sin percibirle a nadie, y el 43% de los clientes facturables lleva
 * percepción.
 *
 * Hermano de cruce-padron-iibb.mjs, que solo mide. Este ESCRIBE en Firestore.
 *
 * Lo que se guarda en cada cliente:
 *
 *   percepcionIIBB: {
 *     alicuota:      3,              // % sobre el NETO
 *     vigenciaDesde: '2026-09-01',
 *     vigenciaHasta: '2026-09-30',
 *     origen:        'padron-agip',
 *     padron:        'ARDJU008092026.TXT',
 *     actualizadoEn: <timestamp>,
 *   }
 *
 * La vigencia sale del propio archivo, no de la fecha en que se corre: es lo que
 * permite que `percepcionVigente` se niegue a facturar con un padrón vencido en
 * vez de emitir mal en silencio.
 *
 * A los clientes que YA NO figuran en el padrón (o que pasaron a alícuota 0) se
 * les BORRA el campo: quedarse con la alícuota del mes pasado es exactamente el
 * error que hay que evitar.
 *
 * Uso:
 *   node scripts/arca/importar-padron-iibb.mjs <padron.TXT>              (simulacro)
 *   node scripts/arca/importar-padron-iibb.mjs <padron.TXT> --escribir   (de verdad)
 *
 * Sin --escribir no toca nada: imprime qué haría. Corre contra la base de
 * PRODUCCIÓN, así que conviene mirar el simulacro antes.
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

const PADRON   = process.argv[2]
const ESCRIBIR = process.argv.includes('--escribir')

if (!PADRON) {
  console.error('Uso: node scripts/arca/importar-padron-iibb.mjs <padron.TXT> [--escribir]')
  console.error('(el archivo viene comprimido de AGIP; hay que descomprimirlo antes)')
  process.exit(1)
}

/** ddmmaaaa -> Date */
function fechaPadron(s) {
  if (!/^\d{8}$/.test(s ?? '')) return null
  return new Date(Number(s.slice(4)), Number(s.slice(2, 4)) - 1, Number(s.slice(0, 2)))
}

const iso     = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null)
const aNumero = (s) => parseFloat(String(s ?? '0').replace(',', '.')) || 0

async function main() {
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()

  console.log(ESCRIBIR
    ? '*** MODO ESCRITURA: se van a actualizar los clientes en producción ***\n'
    : 'Simulacro: no se escribe nada. Agregá --escribir para aplicarlo.\n')

  // ── Clientes de la app, indexados por CUIT ─────────────────────────────────
  const snap = await db.collection('users').where('rol', '==', 'cliente').get()
  const porCuit = new Map()
  const conPercepcionPrevia = new Map()   // uid -> alicuota que ya tenía
  snap.forEach((d) => {
    const u = d.data()
    const cuit = String(u.cuit ?? '').replace(/\D/g, '')
    if (cuit.length === 11) {
      porCuit.set(cuit, { uid: d.id, razonSocial: u.razonSocial ?? u.nombre ?? '' })
    }
    if (u.percepcionIIBB?.alicuota > 0) conPercepcionPrevia.set(d.id, u.percepcionIIBB.alicuota)
  })
  console.log(`Clientes con CUIT: ${porCuit.size}   (con percepción cargada hoy: ${conPercepcionPrevia.size})`)

  // ── Padrón ─────────────────────────────────────────────────────────────────
  const rl = readline.createInterface({
    input: createReadStream(PADRON, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  })

  let total = 0
  let vigenciaDesde = null
  let vigenciaHasta = null
  const aAplicar = []        // clientes que pasan a tener percepción
  const difieren = []        // percepción != retención: ver el aviso del final

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

    // Campo 8 = percepción, campo 9 = retención. NO son lo mismo.
    const alicuota  = aNumero(p[7])
    const retencion = aNumero(p[8])
    if (alicuota !== retencion) difieren.push({ ...cli, cuit: p[3], alicuota, retencion })
    if (alicuota <= 0) continue

    aAplicar.push({ ...cli, cuit: p[3], alicuota })
  }

  const hoy = new Date()
  console.log(`\nPadrón: ${total.toLocaleString()} registros`)
  console.log(`Vigencia: ${iso(vigenciaDesde)} → ${iso(vigenciaHasta)}`)

  if (!vigenciaDesde || !vigenciaHasta) {
    console.error('\nNo se pudo leer la vigencia del padrón. Sin vigencia no se importa nada:')
    console.error('es el dato que impide facturar con alícuotas viejas.')
    process.exit(1)
  }

  if (hoy > vigenciaHasta) {
    console.error(`\n*** ESTE PADRÓN ESTÁ VENCIDO (venció el ${iso(vigenciaHasta)}) ***`)
    console.error('Importarlo dejaría a todos los clientes con una vigencia ya expirada y la app')
    console.error('se negaría a facturarles. Bajá el del mes en curso desde AGIP.')
    process.exit(1)
  }

  // ── Qué cambia ─────────────────────────────────────────────────────────────
  const uidsEnPadron = new Set(aAplicar.map((c) => c.uid))
  const aBorrar = [...conPercepcionPrevia.keys()].filter((uid) => !uidsEnPadron.has(uid))

  console.log(`\nClientes a los que se les carga percepción: ${aAplicar.length}`)
  console.log(`Clientes a los que se les BORRA (ya no están en el padrón): ${aBorrar.length}`)
  if (difieren.length > 0) {
    console.log(`\nOJO: ${difieren.length} clientes tienen percepción distinta de retención.`)
    console.log('Se usa la de PERCEPCIÓN (campo 8). Vale confirmarlo contra Tango para alguno:')
    for (const d of difieren.slice(0, 5)) {
      console.log(`  ${d.cuit}  ${d.razonSocial.slice(0, 40).padEnd(40)} percep ${d.alicuota}%  reten ${d.retencion}%`)
    }
  }

  const porTasa = {}
  for (const c of aAplicar) {
    const k = c.alicuota.toFixed(2)
    porTasa[k] = (porTasa[k] ?? 0) + 1
  }
  console.log('\nAlícuotas a aplicar:')
  for (const [t, n] of Object.entries(porTasa).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
    console.log(`  ${t.padStart(6)}%  ${String(n).padStart(4)} clientes`)
  }

  mkdirSync(SALIDA_DIR, { recursive: true })
  const salida = path.join(SALIDA_DIR, 'padron-iibb-importado.json')
  writeFileSync(salida, JSON.stringify({
    padron: path.basename(PADRON),
    vigenciaDesde: iso(vigenciaDesde),
    vigenciaHasta: iso(vigenciaHasta),
    escrito: ESCRIBIR,
    aAplicar, aBorrar, difieren,
  }, null, 2), 'utf8')
  console.log(`\nDetalle: ${salida}  (gitignoreado: tiene CUIT reales)`)

  if (!ESCRIBIR) {
    console.log('\nSimulacro terminado. Nada se escribió.')
    process.exit(0)
  }

  // ── Escritura ──────────────────────────────────────────────────────────────
  const percepcionBase = {
    vigenciaDesde: iso(vigenciaDesde),
    vigenciaHasta: iso(vigenciaHasta),
    origen: 'padron-agip',
    padron: path.basename(PADRON),
  }

  let batch = db.batch()
  let enBatch = 0
  let escritos = 0
  const flush = async () => {
    if (enBatch === 0) return
    await batch.commit()
    batch = db.batch()
    enBatch = 0
  }

  for (const c of aAplicar) {
    batch.update(db.collection('users').doc(c.uid), {
      percepcionIIBB: {
        ...percepcionBase,
        alicuota: c.alicuota,
        actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
      },
    })
    escritos++
    if (++enBatch >= 400) await flush()
  }

  for (const uid of aBorrar) {
    batch.update(db.collection('users').doc(uid), {
      percepcionIIBB: admin.firestore.FieldValue.delete(),
    })
    escritos++
    if (++enBatch >= 400) await flush()
  }

  await flush()
  console.log(`\n${escritos} clientes actualizados (${aAplicar.length} con percepción, ${aBorrar.length} borrados).`)
  console.log(`Vigencia cargada: ${iso(vigenciaDesde)} → ${iso(vigenciaHasta)}.`)
  console.log('Acordate de volver a correr esto cuando AGIP publique el padrón del mes que viene.')
  process.exit(0)
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
