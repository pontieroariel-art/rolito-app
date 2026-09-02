// Lectura de las facturas "en blanco" que emite Tango — las que se tiraban
// sobre formulario preimpreso: traen los datos, no el diseño.
//
// Es la entrada del recupero de las facturas impagas de 2026 (los PDF con el
// formato viejo se perdieron cuando se dejó Bluesoft). Ver
// docs/tango/INTEGRACION.md §10.
//
// El PDF es un FORMULARIO: cada dato cae siempre en el mismo lugar de la hoja,
// así que se ubica por su banda de Y y su rango de X, en milímetros. Nada de
// buscar por texto: las etiquetas no están (las traía el papel preimpreso).

import { PdfItem } from './parsePdf'
import { FacturaPdfData, FacturaRenglon } from './facturaPdf'

interface Campo { y: number; x: [number, number] }

// Relevado del comprobante 00101-00281898 (13/08/2026).
const CAMPOS: Record<string, Campo> = {
  numero:         { y: 25.7,  x: [130, 200] },
  fecha:          { y: 46.7,  x: [120, 150] },
  razonSocial:    { y: 59.3,  x: [30, 105] },
  vendedor:       { y: 59.3,  x: [150, 200] },
  domicilio:      { y: 67.6,  x: [30, 110] },
  localidad:      { y: 76.0,  x: [30, 110] },
  cuit:           { y: 88.6,  x: [95, 140] },
  codigoCliente:  { y: 88.6,  x: [175, 205] },
  condicionVenta: { y: 97.0,  x: [40, 110] },
  condicionIva:   { y: 105.4, x: [15, 90] },
  neto:           { y: 218.6, x: [170, 205] },
  ivaAlicuota:    { y: 243.7, x: [160, 180] },
  ivaImporte:     { y: 243.7, x: [180, 205] },
  total:          { y: 260.5, x: [170, 205] },
}

// Los renglones viven entre el encabezado y la línea de totales.
const RENGLONES = { desde: 120, hasta: 215 }
const COLS: Record<string, [number, number]> = {
  cantidad:    [15, 40],
  descripcion: [40, 120],
  remito:      [120, 150],
  precio:      [150, 182],
  importe:     [182, 210],
}

// Margen generoso: distintas impresoras corren el texto un par de milímetros.
const TOL_Y = 1.6

const enBanda = (i: PdfItem, c: Campo) =>
  Math.abs(i.y - c.y) <= TOL_Y && i.x >= c.x[0] && i.x <= c.x[1]

/** Tango imprime a la inglesa: "3,250.0000" → 3250 */
function num(texto: string): number {
  const n = Number(String(texto ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

const leer = (items: PdfItem[], campo: Campo) =>
  items.filter((i) => enBanda(i, campo)).map((i) => i.str.trim()).join(' ')

function parsearRenglones(items: PdfItem[]): { renglones: FacturaRenglon[]; remitos: string[] } {
  const porLinea = new Map<number, PdfItem[]>()
  for (const i of items) {
    if (i.y < RENGLONES.desde || i.y > RENGLONES.hasta) continue
    const clave = Math.round(i.y * 2) / 2
    if (!porLinea.has(clave)) porLinea.set(clave, [])
    porLinea.get(clave)!.push(i)
  }

  const renglones: FacturaRenglon[] = []
  const remitos = new Set<string>()

  for (const [, linea] of [...porLinea.entries()].sort((a, b) => a[0] - b[0])) {
    const col = (r: [number, number]) =>
      linea.filter((i) => i.x >= r[0] && i.x < r[1]).map((i) => i.str.trim()).join(' ')

    const descripcion = col(COLS.descripcion)
    const cantidad    = num(col(COLS.cantidad))
    const importe     = num(col(COLS.importe))
    if (!descripcion || (cantidad === 0 && importe === 0)) continue

    const remito = col(COLS.remito)
    if (remito) remitos.add(remito)

    const precio = num(col(COLS.precio))
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

/**
 * Arma la factura a partir del texto posicionado del PDF de Tango.
 *
 * Devuelve el comprobante SIN CAE: el PDF de Tango no lo trae (venía impreso
 * en el formulario). Lo carga a mano quien lo esté mirando en Tango.
 */
export function parsearFacturaTango(items: PdfItem[]): FacturaPdfData {
  const numero = leer(items, CAMPOS.numero).replace(/\s/g, '')
  const m = /^(\d{4,5})-(\d{7,8})$/.exec(numero)
  if (!m) throw new Error(`No se pudo leer el número de comprobante (leí "${numero || 'nada'}")`)

  // La fecha viene partida en tres celdas del formulario: 13 | 08 | 26.
  const partes = items
    .filter((i) => enBanda(i, CAMPOS.fecha))
    .sort((a, b) => a.x - b.x)
    .map((i) => i.str.trim())
  if (partes.length < 3) throw new Error('No se pudo leer la fecha de emisión')
  const [dd, mm, aa] = partes
  const anio = Number(aa) + (Number(aa) < 70 ? 2000 : 1900)

  const { renglones, remitos } = parsearRenglones(items)
  if (renglones.length === 0) throw new Error('No se encontró ningún renglón de detalle')

  // "1428 - CAPITAL FEDERAL" → cp + localidad.
  const localidad = leer(items, CAMPOS.localidad)
  const mLoc = /^(\d{4,})\s*-\s*(.+)$/.exec(localidad)

  return {
    letra: 'A',
    codigoTipo: '01',
    titulo: 'FACTURA',
    puntoVenta: Number(m[1]),
    numero: Number(m[2]),
    fechaEmision: new Date(anio, Number(mm) - 1, Number(dd)),
    fechaVencimiento: null,
    cliente: {
      razonSocial:    leer(items, CAMPOS.razonSocial),
      domicilio:      leer(items, CAMPOS.domicilio),
      cp:             mLoc ? mLoc[1] : '',
      localidad:      mLoc ? mLoc[2] : localidad,
      condicionIva:   leer(items, CAMPOS.condicionIva),
      cuit:           leer(items, CAMPOS.cuit),
      codigo:         leer(items, CAMPOS.codigoCliente),
      vendedor:       leer(items, CAMPOS.vendedor),
      condicionVenta: leer(items, CAMPOS.condicionVenta),
    },
    remitosOC: remitos.length > 0 ? `(${remitos.join(') (')})` : undefined,
    renglones,
    totales: {
      netoGravado:      num(leer(items, CAMPOS.neto)),
      exento:           0,
      percIibbCaba:     0,
      percIibbCabaAlic: 0,
      iva:              num(leer(items, CAMPOS.ivaImporte)),
      ivaAlic:          num(leer(items, CAMPOS.ivaAlicuota)) || 21,
      percIibbBa:       0,
      percIibbBaAlic:   0,
      internos:         0,
      total:            num(leer(items, CAMPOS.total)),
    },
    cae: '',
    caeVto: new Date(0),
  }
}

/**
 * Control aritmético: los renglones tienen que dar el neto, y neto + IVA el
 * total. Es la red contra un PDF que se lea torcido — un renglón que caiga
 * fuera de la banda esperada se nota acá y no en el comprobante impreso.
 */
export function verificarFactura(f: FacturaPdfData): string[] {
  const avisos: string[] = []
  const cent = (n: number) => Math.round(n * 100)
  const money = (n: number) =>
    n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const suma = f.renglones.reduce((s, r) => s + r.importe, 0)
  if (Math.abs(cent(suma) - cent(f.totales.netoGravado)) > 1) {
    avisos.push(`Los renglones suman ${money(suma)} pero el neto dice ${money(f.totales.netoGravado)}`)
  }
  const calculado = f.totales.netoGravado + f.totales.iva
  if (Math.abs(cent(calculado) - cent(f.totales.total)) > 1) {
    avisos.push(`Neto + IVA da ${money(calculado)} pero el total dice ${money(f.totales.total)}`)
  }
  return avisos
}
