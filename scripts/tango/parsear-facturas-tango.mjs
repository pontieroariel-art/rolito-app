/**
 * Lee los PDF "en blanco" que emite Tango (los que se imprimen sobre formulario
 * preimpreso: traen los datos, no el diseño) y arma el JSON de entrada de
 * generar-facturas-pdf.mjs.
 *
 * Parte del recupero de las facturas impagas de 2026 — ver
 * docs/tango/INTEGRACION.md §10.
 *
 * El PDF de Tango NO trae el CAE (el preimpreso lo tenía aparte). Se completa
 * con `--caes archivo.json`, un mapa que sale de la consulta de Tango con la
 * columna "C.A.I. / C.A.E." exportada:
 *
 *   { "00101-00281898": { "cae": "86339023363846", "caeVto": "2026-08-29" } }
 *
 * Sin CAE la factura igual se escribe en el JSON, pero con `cae: ""` — y
 * generar-facturas-pdf.mjs la rechaza y la lista al final. Es a propósito:
 * mejor que falte a que salga un comprobante sin su autorización.
 *
 * Uso:
 *   node scripts/tango/parsear-facturas-tango.mjs <carpeta-o-pdf> [salida.json] [--caes caes.json]
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const posicionales = args.filter((a) => !a.startsWith('--'))
const [entrada, salida = 'facturas.json'] = posicionales
const idxCaes = args.indexOf('--caes')
const archivoCaes = idxCaes >= 0 ? args[idxCaes + 1] : null

if (!entrada) {
  console.error('Uso: node scripts/tango/parsear-facturas-tango.mjs <carpeta-o-pdf> [salida.json] [--caes caes.json]')
  process.exit(1)
}

// ── Layout del formulario de Tango ───────────────────────────────────────────
// Las posiciones son fijas (es un formulario, no un flujo de texto), así que
// cada dato se ubica por su banda de Y y su rango de X, ambos en mm. Los
// márgenes son generosos: distintas impresoras/versiones corren el texto un
// par de milímetros.
const CAMPOS = {
  numero:        { y: 25.7, x: [130, 200] },
  fecha:         { y: 46.7, x: [120, 150] },   // día / mes / año, en tres pedazos
  razonSocial:   { y: 59.3, x: [30, 105] },
  vendedor:      { y: 59.3, x: [150, 200] },
  domicilio:     { y: 67.6, x: [30, 110] },
  localidad:     { y: 76.0, x: [30, 110] },
  cuit:          { y: 88.6, x: [95, 140] },
  codigoCliente: { y: 88.6, x: [175, 205] },
  condicionVenta:{ y: 97.0, x: [40, 110] },
  condicionIva:  { y: 105.4, x: [15, 90] },
  neto:          { y: 218.6, x: [170, 205] },
  ivaAlicuota:   { y: 243.7, x: [160, 180] },
  ivaImporte:    { y: 243.7, x: [180, 205] },
  total:         { y: 260.5, x: [170, 205] },
}

// Los renglones viven entre el encabezado y la línea de totales.
const RENGLONES = { desde: 120, hasta: 215 }
const COLS = {
  cantidad:    [15, 40],
  descripcion: [40, 120],
  remito:      [120, 150],
  precio:      [150, 182],
  importe:     [182, 210],
}

const TOLERANCIA_Y = 1.6

function enBanda(item, campo) {
  return Math.abs(item.y - campo.y) <= TOLERANCIA_Y && item.x >= campo.x[0] && item.x <= campo.x[1]
}

function enColumna(item, rango) {
  return item.x >= rango[0] && item.x < rango[1]
}

/** "3,250.0000" → 3250 ; "107,496.40" → 107496.4 */
function num(texto) {
  const limpio = String(texto ?? '').replace(/,/g, '').trim()
  const n = Number(limpio)
  return Number.isFinite(n) ? n : 0
}

function primero(items, campo) {
  const encontrados = items.filter((i) => enBanda(i, campo))
  return encontrados.length > 0 ? encontrados.map((i) => i.str.trim()).join(' ') : ''
}

async function textoDelPdf(archivo) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(archivo)),
    useSystemFonts: false,
  }).promise
  // Solo la página 1: la 2 es el duplicado, idéntica.
  const page = await doc.getPage(1)
  const vp = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  return content.items
    .filter((i) => i.str.trim())
    .map((i) => ({
      x: +((i.transform[4] * 25.4) / 72).toFixed(1),
      y: +(((vp.height - i.transform[5]) * 25.4) / 72).toFixed(1),
      str: i.str,
    }))
}

function parsearRenglones(items) {
  // Se agrupan por Y: cada renglón del formulario es una línea.
  const porLinea = new Map()
  for (const i of items) {
    if (i.y < RENGLONES.desde || i.y > RENGLONES.hasta) continue
    const clave = Math.round(i.y * 2) / 2
    if (!porLinea.has(clave)) porLinea.set(clave, [])
    porLinea.get(clave).push(i)
  }

  const renglones = []
  const remitos = new Set()

  for (const [, linea] of [...porLinea.entries()].sort((a, b) => a[0] - b[0])) {
    const dame = (rango) => linea.filter((i) => enColumna(i, rango)).map((i) => i.str.trim()).join(' ')

    const descripcion = dame(COLS.descripcion)
    const cantidad    = num(dame(COLS.cantidad))
    const importe     = num(dame(COLS.importe))
    if (!descripcion || (cantidad === 0 && importe === 0)) continue

    const remito = dame(COLS.remito)
    if (remito) remitos.add(remito)

    const precio = num(dame(COLS.precio))
    renglones.push({
      descripcion,
      um: 'UNI',
      cantidad,
      // Tango imprime el unitario con 4 decimales; si faltara, se deriva.
      precioUnitario: precio || (cantidad ? importe / cantidad : 0),
      importe,
    })
  }

  return { renglones, remitos: [...remitos] }
}

function parsearFactura(items, archivo) {
  const numero = primero(items, CAMPOS.numero)
  const m = /^(\d{4,5})-(\d{7,8})$/.exec(numero.replace(/\s/g, ''))
  if (!m) throw new Error(`no se pudo leer el número de comprobante (leí "${numero}")`)

  // La fecha viene partida en tres celdas del formulario: 13 | 08 | 26.
  const partes = items
    .filter((i) => enBanda(i, CAMPOS.fecha))
    .sort((a, b) => a.x - b.x)
    .map((i) => i.str.trim())
  if (partes.length < 3) throw new Error(`no se pudo leer la fecha (leí "${partes.join('/')}")`)
  const [dd, mm, aa] = partes
  const anio = Number(aa) + (Number(aa) < 70 ? 2000 : 1900)

  const { renglones, remitos } = parsearRenglones(items)
  if (renglones.length === 0) throw new Error('no se encontró ningún renglón')

  // "1428 - CAPITAL FEDERAL" → cp + localidad.
  const localidad = primero(items, CAMPOS.localidad)
  const mLoc = /^(\d{4,})\s*-\s*(.+)$/.exec(localidad)

  const neto  = num(primero(items, CAMPOS.neto))
  const iva   = num(primero(items, CAMPOS.ivaImporte))
  const total = num(primero(items, CAMPOS.total))

  return {
    archivo: path.basename(archivo),
    letra: 'A',
    codigoTipo: '01',
    titulo: 'FACTURA',
    puntoVenta: Number(m[1]),
    numero: Number(m[2]),
    fechaEmision: `${anio}-${String(Number(mm)).padStart(2, '0')}-${String(Number(dd)).padStart(2, '0')}`,
    fechaVencimiento: null,
    cliente: {
      razonSocial:    primero(items, CAMPOS.razonSocial),
      domicilio:      primero(items, CAMPOS.domicilio),
      cp:             mLoc ? mLoc[1] : '',
      localidad:      mLoc ? mLoc[2] : localidad,
      condicionIva:   primero(items, CAMPOS.condicionIva),
      cuit:           primero(items, CAMPOS.cuit),
      codigo:         primero(items, CAMPOS.codigoCliente),
      vendedor:       primero(items, CAMPOS.vendedor),
      condicionVenta: primero(items, CAMPOS.condicionVenta),
    },
    remitosOC: remitos.length > 0 ? `(${remitos.join(') (')})` : undefined,
    renglones,
    totales: {
      netoGravado: neto,
      exento: 0,
      percIibbCaba: 0, percIibbCabaAlic: 0,
      iva,
      ivaAlic: num(primero(items, CAMPOS.ivaAlicuota)) || 21,
      percIibbBa: 0, percIibbBaAlic: 0,
      internos: 0,
      total,
    },
    cae: '',
    caeVto: '',
  }
}

/** Control aritmético: los renglones tienen que dar el neto, y neto+IVA el total. */
function verificar(f) {
  const avisos = []
  const cent = (n) => Math.round(n * 100)
  const sumaRenglones = f.renglones.reduce((s, r) => s + r.importe, 0)
  if (Math.abs(cent(sumaRenglones) - cent(f.totales.netoGravado)) > 1) {
    avisos.push(`los renglones suman ${sumaRenglones.toFixed(2)} y el neto dice ${f.totales.netoGravado.toFixed(2)}`)
  }
  const calculado = f.totales.netoGravado + f.totales.iva
  if (Math.abs(cent(calculado) - cent(f.totales.total)) > 1) {
    avisos.push(`neto + IVA = ${calculado.toFixed(2)} pero el total dice ${f.totales.total.toFixed(2)}`)
  }
  return avisos
}

// ── Corrida ──────────────────────────────────────────────────────────────────
const stat = fs.statSync(entrada)
const archivos = stat.isDirectory()
  ? fs.readdirSync(entrada).filter((n) => n.toLowerCase().endsWith('.pdf')).map((n) => path.join(entrada, n))
  : [entrada]

const caes = archivoCaes ? JSON.parse(fs.readFileSync(archivoCaes, 'utf-8')) : {}

const facturas = []
const fallidas = []
const sinCae = []

for (const archivo of archivos) {
  try {
    const f = parsearFactura(await textoDelPdf(archivo), archivo)

    const clave = `${String(f.puntoVenta).padStart(5, '0')}-${String(f.numero).padStart(8, '0')}`
    const datosCae = caes[clave]
    if (datosCae) {
      f.cae = String(datosCae.cae ?? '').trim()
      f.caeVto = datosCae.caeVto ?? ''
    }
    if (!f.cae) sinCae.push(clave)

    const avisos = verificar(f)
    if (avisos.length > 0) console.log(`  ! ${clave}: ${avisos.join('; ')}`)

    facturas.push(f)
  } catch (err) {
    fallidas.push({ archivo: path.basename(archivo), motivo: err instanceof Error ? err.message : String(err) })
  }
}

fs.writeFileSync(salida, JSON.stringify(facturas, null, 1))

console.log(`\n${facturas.length} facturas leídas -> ${path.resolve(salida)}`)
if (sinCae.length > 0) {
  console.log(`\n${sinCae.length} sin CAE (no se van a poder imprimir hasta completarlo con --caes):`)
  console.log('  ' + sinCae.join('\n  '))
}
if (fallidas.length > 0) {
  console.log(`\n${fallidas.length} no se pudieron leer:`)
  for (const f of fallidas) console.log(`  ${f.archivo}: ${f.motivo}`)
}
