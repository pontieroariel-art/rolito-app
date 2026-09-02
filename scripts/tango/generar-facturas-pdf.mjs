/**
 * Recupero de las facturas viejas de Bluesoft (2026): genera en lote el PDF de
 * cada comprobante pendiente de cobro emitido hasta el 20/08/2026.
 *
 * Esto NO es parte de la app: es una corrida puntual. Los PDF que salen de acá
 * son REIMPRESIONES de facturas ya emitidas y autorizadas — nunca se pide un
 * CAE nuevo, cada una lleva el CAE original que ya tiene el comprobante.
 *
 * Entrada: un JSON con las facturas (el que arma el export desde Tango, ver
 * relevar-facturas-tango.ps1). Formato de cada elemento: los campos de
 * FacturaPdfData de src/utils/facturaPdf.ts, con las fechas como 'YYYY-MM-DD'
 * o 'dd/MM/yyyy'.
 *
 * Salen sin ninguna leyenda: son la misma factura que el cliente ya recibió,
 * con su CAE original. `--duplicado` agrega "DUPLICADO — REIMPRESIÓN" arriba a
 * la derecha, por si en algún caso conviene aclararlo.
 *
 * Uso:
 *   node scripts/tango/generar-facturas-pdf.mjs facturas.json salida/
 *   node scripts/tango/generar-facturas-pdf.mjs facturas.json salida/ --duplicado
 *
 * El generador está en TypeScript, así que se transpila al vuelo con esbuild
 * (ya viene con vite) en vez de mantener una copia del layout acá.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const [entrada, salidaDir = 'facturas-pdf'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const CON_LEYENDA = process.argv.includes('--duplicado')

if (!entrada) {
  console.error('Uso: node scripts/tango/generar-facturas-pdf.mjs <facturas.json> [salida/] [--duplicado]')
  process.exit(1)
}

// ── El generador de PDF, transpilado al vuelo ────────────────────────────────
// El bundle sale dentro del repo a propósito: desde node_modules/.cache los
// externals (jspdf, qrcode) resuelven solos.
async function cargarGenerador() {
  const esbuild = await import('esbuild')
  const salida  = path.join(RAIZ, 'node_modules/.cache/facturaPdf.mjs')
  fs.mkdirSync(path.dirname(salida), { recursive: true })
  await esbuild.build({
    entryPoints: [path.join(RAIZ, 'src/utils/facturaPdf.ts')],
    bundle:   true,
    platform: 'node',
    format:   'esm',
    external: ['jspdf', 'jspdf-autotable', 'qrcode'],
    outfile:  salida,
    logLevel: 'warning',
  })
  return import(pathToFileURL(salida).href)
}

// ── Fechas ───────────────────────────────────────────────────────────────────
// Se construyen con componentes locales (no `new Date(iso)`, que interpreta
// 'YYYY-MM-DD' como UTC y en Argentina retrocede un día).
function aFecha(valor, campo) {
  if (valor instanceof Date) return valor
  const texto = String(valor ?? '').trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  throw new Error(`fecha inválida en ${campo}: "${texto}"`)
}

function normalizar(f) {
  // El CAE sale de Tango, es el que ARCA ya autorizó para ese comprobante.
  // Sin él (o sin su vencimiento) el PDF no es una factura válida y el código
  // de barras del pie sale mal: mejor que falle y quede en el listado del
  // final, para ir a buscar ese CAE a mano.
  if (!/^\d{14}$/.test(String(f.cae ?? '').trim())) {
    throw new Error(`CAE ausente o inválido ("${f.cae ?? ''}") — no se puede reimprimir sin el CAE original`)
  }
  if (!f.caeVto) throw new Error('falta el vencimiento del CAE')

  return {
    ...f,
    cae: String(f.cae).trim(),
    fechaEmision:     aFecha(f.fechaEmision, 'fechaEmision'),
    fechaVencimiento: f.fechaVencimiento ? aFecha(f.fechaVencimiento, 'fechaVencimiento') : null,
    caeVto:           aFecha(f.caeVto, 'caeVto'),
    // Las imágenes van como data URI: en Node no hay fetch a /public.
    logoDataUrl:        imagen('public/logo-rolito-factura.png'),
    marcaDeAguaDataUrl: imagen('public/marca-agua-factura.jpg'),
    leyendaCopia: CON_LEYENDA ? (f.leyendaCopia ?? 'DUPLICADO — REIMPRESIÓN') : undefined,
    descargar: false,
  }
}

const cacheImagenes = new Map()
function imagen(relativa) {
  if (!cacheImagenes.has(relativa)) {
    const archivo = path.join(RAIZ, relativa)
    const ext = path.extname(archivo).slice(1).toLowerCase()
    const mime = ext === 'jpg' ? 'jpeg' : ext
    cacheImagenes.set(relativa, `data:image/${mime};base64,` + fs.readFileSync(archivo).toString('base64'))
  }
  return cacheImagenes.get(relativa)
}

// ── Corrida ──────────────────────────────────────────────────────────────────
const { generateFacturaPdf } = await cargarGenerador()

const facturas = JSON.parse(fs.readFileSync(entrada, 'utf-8'))
if (!Array.isArray(facturas)) {
  console.error('El JSON de entrada tiene que ser un array de facturas.')
  process.exit(1)
}

fs.mkdirSync(salidaDir, { recursive: true })

let generadas = 0
const fallidas = []

for (const cruda of facturas) {
  const etiqueta = `${cruda.titulo ?? 'FACTURA'} ${String(cruda.puntoVenta).padStart(5, '0')}-${String(cruda.numero).padStart(8, '0')}`
  try {
    const blob = await generateFacturaPdf(normalizar(cruda))
    const nombre = `${String(cruda.puntoVenta).padStart(5, '0')}-${String(cruda.numero).padStart(8, '0')}.pdf`
    fs.writeFileSync(path.join(salidaDir, nombre), Buffer.from(await blob.arrayBuffer()))
    generadas++
    if (generadas % 50 === 0) console.log(`  ${generadas}/${facturas.length}...`)
  } catch (err) {
    fallidas.push({ etiqueta, motivo: err instanceof Error ? err.message : String(err) })
  }
}

console.log(`\n${generadas} PDF generados en ${path.resolve(salidaDir)}`)
if (fallidas.length > 0) {
  console.log(`\n${fallidas.length} fallaron:`)
  for (const f of fallidas) console.log(`  ${f.etiqueta}: ${f.motivo}`)
  process.exit(1)
}
