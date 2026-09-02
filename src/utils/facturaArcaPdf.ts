// Comprobante impreso de las facturas que emite la app con ARCA.
//
// Réplica del formato que Tango emite hoy (relevado de `Factura final tango.pdf`,
// comprobante 00101-00282333 del 26/08/2026): barras de sección verdes, bloque
// de resumen a la derecha y el QR de la RG 4892 al pie. Es el diseño que el
// cliente viene recibiendo, así que no conviene inventar otro.
//
// ⚠️ No confundir con `facturaPdf.ts`, que replica el comprobante HISTÓRICO (el
// de Bluesoft, con la conservadora de marca de agua) y solo se usa para
// reimprimir las facturas viejas en /admin/recupero-facturas. Son dos formatos
// distintos y cada uno tiene que seguir saliendo como está.
//
// El original de Tango viene en tamaño carta; acá se dibuja en A4, que es el
// papel que se usa y el de todos los PDF de la app. El layout es fluido, así
// que no se deforma nada.

import { generateQrDataUrl } from './qr'
import { urlQrArca } from './arcaQr'

export const EMISOR_ARCA = {
  razonSocial:     'Redonhielo SA',
  domicilio:       'Av. Panamericana KM 25.700 Km 25700',
  telefono:        '(011) 4741-8000',
  email:           'ventas@redonhielo.com.ar',
  condicionIva:    'Responsable inscripto',
  cbu:             '0720072420000001271304',
  cuit:            '30-69766897-3',
  ingresosBrutos:  '9024264411',
  inicioActividad: '01/07/1998',
}

export interface RenglonArca {
  descripcion:    string
  cantidad:       number
  unidad:         string      // 'UNI', 'KG', …
  precioUnitario: number
  total:          number
  /** Líneas sueltas debajo del renglón, como la orden de compra del cliente. */
  notas?:         string[]
}

export interface FacturaArcaData {
  /** 'A' | 'B' | 'C' — se imprime como "FACTURA A". */
  letra:        'A' | 'B' | 'C'
  /** Código de tipo de ARCA: '01' = Factura A, '06' = Factura B, '11' = C. */
  codigoTipo:   string
  puntoVenta:   number
  numero:       number
  fechaEmision: Date

  emisor?: typeof EMISOR_ARCA

  cliente: {
    razonSocial:    string
    cuit:           string
    condicionIva:   string
    domicilio:      string
    condicionVenta: string
    vendedor:       string
  }

  renglones: RenglonArca[]

  /** Cuota de pago: importe y fecha. En contado se omite. */
  vencimiento?: { importe: number; fecha: Date }

  totales: {
    subtotal:      number
    bonificaciones: number
    iva:           number
    percIibbCaba:  number
    total:         number
  }

  cae:    string
  caeVto: Date

  /** Logo ya en base64, para correr fuera del browser. */
  logoDataUrl?: string
  /** Si es false, devuelve el blob en vez de descargar. */
  descargar?: boolean
}

// ── Estilo ───────────────────────────────────────────────────────────────────
// El verde de las barras de sección, tomado del comprobante de Tango. Es más
// oscuro que el acento de la app (#1D9E75): sobre él va texto blanco.
const VERDE: [number, number, number] = [23, 92, 63]
const GRIS_LINEA: [number, number, number] = [190, 190, 190]

const X0 = 12          // margen izquierdo
const X1 = 198         // margen derecho
const XD = 112         // arranque de la columna derecha del encabezado

// Importes: el comprobante de Tango los escribe "$ 168000.00", sin separador de
// miles y con punto decimal. Se respeta para que salga igual.
const money = (n: number) => `$ ${n.toFixed(2)}`
const cant  = (n: number) => n.toFixed(2)
const fecha = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`

export async function generateFacturaArcaPdf(d: FacturaArcaData): Promise<Blob | void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const emisor = d.emisor ?? EMISOR_ARCA

  const barra = (titulo: string, y: number, alto = 6.5) => {
    doc.setFillColor(...VERDE)
    doc.rect(X0, y, X1 - X0, alto, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(titulo, X0 + 2.5, y + alto - 2)
    doc.setTextColor(0, 0, 0)
  }

  const linea = (y: number) => {
    doc.setDrawColor(...GRIS_LINEA)
    doc.setLineWidth(0.2)
    doc.line(X0, y, X1, y)
  }

  /** Etiqueta en negrita + valor normal, en la misma línea. */
  const campo = (etiqueta: string, valor: string, x: number, y: number, tam = 7.5) => {
    doc.setFontSize(tam)
    doc.setFont('helvetica', 'bold')
    doc.text(etiqueta, x, y)
    const ancho = doc.getTextWidth(etiqueta)
    doc.setFont('helvetica', 'normal')
    doc.text(valor, x + ancho + 1.2, y)
  }

  // ── Encabezado ─────────────────────────────────────────────────────────────
  const logo = d.logoDataUrl ?? (await fetchLogo())
  if (logo) doc.addImage(logo, 'PNG', X0, 10, 46, 15.6)

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(emisor.razonSocial, X0 + 12, 32)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  let y = 36
  for (const l of [
    `Domicilio: ${emisor.domicilio}`,
    `Tel.: ${emisor.telefono}  Email: ${emisor.email}`,
    `Condición frente al IVA: ${emisor.condicionIva}`,
    `CBU.N° ${emisor.cbu}`,
  ]) {
    doc.text(l, X0, y)
    y += 4.6
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(`FACTURA ${d.letra}`, XD + 42, 20, { align: 'center' })

  doc.setFontSize(7.5)
  const nro = `${String(d.puntoVenta).padStart(5, '0')}-${String(d.numero).padStart(8, '0')}`
  campo('Punto de venta - Nro . comp.:', nro, XD, 27)
  campo('Fecha de emisión:', fecha(d.fechaEmision), XD, 33)
  campo('CUIT:', emisor.cuit, XD, 41)
  campo('Ingresos brutos:', emisor.ingresosBrutos, XD, 47)
  campo('Fecha de inicio de actividades:', emisor.inicioActividad, XD, 53)

  linea(57)

  // ── Cliente ────────────────────────────────────────────────────────────────
  barra('Información del cliente', 61)

  campo('Razón social:', d.cliente.razonSocial, X0, 73)
  campo('CUIT:', d.cliente.cuit, 152, 73)
  campo('Condición frente al IVA:', d.cliente.condicionIva, X0, 79)
  campo('Domicilio:', d.cliente.domicilio, XD, 79)
  campo('Condicion de venta:', d.cliente.condicionVenta, X0, 85)
  campo('Vendedor:', d.cliente.vendedor, XD, 85)

  linea(89)

  // ── Detalle ────────────────────────────────────────────────────────────────
  const DET_Y = 93
  barra('Detalle', DET_Y)
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Cant.',      140, DET_Y + 4.5, { align: 'right' })
  doc.text('P.Unitario', 168, DET_Y + 4.5, { align: 'right' })
  doc.text('Total',      X1 - 2.5, DET_Y + 4.5, { align: 'right' })
  doc.setTextColor(0, 0, 0)

  y = DET_Y + 12
  doc.setFontSize(7.5)
  for (const r of d.renglones) {
    doc.setFont('helvetica', 'normal')
    doc.text(r.descripcion, X0, y)
    doc.text(`${cant(r.cantidad)} ${r.unidad}`, 140, y, { align: 'right' })
    doc.text(r.precioUnitario.toFixed(2), 168, y, { align: 'right' })
    doc.text(money(r.total), X1 - 2.5, y, { align: 'right' })
    y += 5
    for (const nota of r.notas ?? []) {
      doc.text(nota, X0 + 14, y)
      y += 5
    }
  }

  // ── Vencimiento ────────────────────────────────────────────────────────────
  // Solo en cuenta corriente: una venta de contado no tiene cuota que vencer.
  if (d.vencimiento) {
    y += 2
    doc.setFillColor(...VERDE)
    doc.rect(X0, y, 78, 6, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('Importe', X0 + 8, y + 4.2)
    doc.text('Vencimiento', X0 + 46, y + 4.2)
    doc.setTextColor(0, 0, 0)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(d.vencimiento.importe.toFixed(2), X0 + 4, y + 11)
    doc.text(fecha(d.vencimiento.fecha), X0 + 46, y + 11)
    y += 15
  } else {
    y += 4
  }

  // ── Resumen ────────────────────────────────────────────────────────────────
  const RES_Y = Math.max(y, 130)
  barra('Resumen', RES_Y)

  // El bloque de totales va a la derecha, con las filas en gris alterno como el
  // original.
  const RX0 = 117
  const t = d.totales
  const filas: Array<[string, string, boolean]> = [
    ['Subtotal',       money(t.subtotal),       true],
    ['Bonificaciones', money(t.bonificaciones), false],
  ]

  let fy = RES_Y + 12
  doc.setFontSize(7.5)
  for (const [etiqueta, valor, sombra] of filas) {
    if (sombra) {
      doc.setFillColor(238, 238, 238)
      doc.rect(RX0, fy - 3.6, X1 - RX0, 5.4, 'F')
    }
    doc.setFont('helvetica', 'normal')
    doc.text(etiqueta, RX0 + 2, fy)
    doc.text(valor, X1 - 2, fy, { align: 'right' })
    fy += 6
  }

  // La leyenda de la Ley 27.743 va subrayada y ocupa la fila entera, sin importe.
  doc.setFontSize(6.5)
  const leyenda = 'Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)'
  doc.text(leyenda, RX0 + 2, fy)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.15)
  doc.line(RX0 + 2, fy + 0.7, RX0 + 2 + doc.getTextWidth(leyenda), fy + 0.7)
  fy += 6

  doc.setFontSize(7.5)
  for (const [etiqueta, valor, sombra] of [
    ['IVA', money(t.iva), true],
    ['Perc.IIBB CABA', money(t.percIibbCaba), false],
  ] as Array<[string, string, boolean]>) {
    if (sombra) {
      doc.setFillColor(238, 238, 238)
      doc.rect(RX0, fy - 3.6, X1 - RX0, 5.4, 'F')
    }
    doc.setFont('helvetica', 'normal')
    doc.text(etiqueta, RX0 + 2, fy)
    doc.text(valor, X1 - 2, fy, { align: 'right' })
    fy += 6
  }

  // Total, en barra verde
  doc.setFillColor(...VERDE)
  doc.rect(RX0, fy - 4, X1 - RX0, 7.5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text('Total', RX0 + 2, fy + 1)
  doc.text(money(t.total), X1 - 2, fy + 1, { align: 'right' })
  doc.setTextColor(0, 0, 0)

  // ── Pie: QR, CAE y leyendas ────────────────────────────────────────────────
  const PIE_Y = 252
  linea(PIE_Y - 6)

  const qr = await generateQrDataUrl(urlQrArca({
    fechaEmision: d.fechaEmision,
    cuitEmisor:   emisor.cuit,
    puntoVenta:   d.puntoVenta,
    codigoTipo:   d.codigoTipo,
    numero:       d.numero,
    importeTotal: t.total,
    cuitReceptor: d.cliente.cuit,
    cae:          d.cae,
  }))
  doc.addImage(qr, 'PNG', X0, PIE_Y, 20, 20)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(`CAE : ${d.cae}`, X0 + 24, PIE_Y + 3)
  doc.text(`Fecha vto.: ${fecha(d.caeVto)}`, X0 + 24, PIE_Y + 7)

  doc.setFontSize(6.5)
  let ly = PIE_Y + 12
  for (const l of [
    'La mora en el pago de la factura producirá un interés punitorio del cero, dos por ciento (0.2%) diario acumulativo.',
    'Se deja expresamente establecido que el domicilio de pago del presente y el lugar de cumplimiento de la obligacion',
    `son el de ${emisor.razonSocial.replace(/\s*SA$/, ' S.A.')}`,
  ]) {
    doc.text(l, X0 + 24, ly)
    ly += 3.4
  }

  doc.setFontSize(7)
  doc.text('1', 105, 285, { align: 'center' })

  const nombre = `factura-${nro}.pdf`
  if (d.descargar === false) return doc.output('blob')
  doc.save(nombre)
}

// Mismo criterio que facturaPdf.ts: se reescala antes de incrustar, porque el
// PNG fuente son 8334 px de ancho.
async function fetchLogo(): Promise<string | null> {
  if (typeof document === 'undefined') return null
  try {
    const resp = await fetch('/logo-rolito-factura.png')
    if (!resp.ok) return null
    const bitmap = await createImageBitmap(await resp.blob())
    const scale = Math.min(1, 500 / bitmap.width)
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
