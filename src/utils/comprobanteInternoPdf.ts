// PDF del comprobante interno de la venta del camión (remito o factura "X").
//
// Mismo diseño que la factura de ARCA (facturaArcaPdf.ts) para que el cliente
// reciba siempre el mismo papel, pero SIN QR de AFIP, sin CAE ni código de
// barras, con la letra X y la leyenda "documento no válido como factura" bien
// visible: no es un comprobante fiscal y no tiene que parecerlo. Lleva la firma
// del cliente al pie (decisión 2026-09-03).

import type { ComprobanteInternoData } from './comprobanteInterno'

const VERDE: [number, number, number] = [23, 92, 63]
const NARANJA: [number, number, number] = [194, 65, 12]   // Rolito (promo)
const GRIS_LINEA: [number, number, number] = [190, 190, 190]

const X0 = 12
const X1 = 198
const XD = 112

const money = (n: number) => `$ ${n.toFixed(2)}`
const cant  = (n: number) => n.toFixed(2)
const fecha = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`

export async function generateComprobanteInternoPdf(
  d: ComprobanteInternoData,
  opts: { descargar?: boolean } = {},
): Promise<Blob | void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const color = d.empresa === 'rolito' ? NARANJA : VERDE

  const barra = (titulo: string, y: number, alto = 6.5) => {
    doc.setFillColor(...color)
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
  const campo = (etiqueta: string, valor: string, x: number, y: number, tam = 7.5) => {
    doc.setFontSize(tam)
    doc.setFont('helvetica', 'bold')
    doc.text(etiqueta, x, y)
    const ancho = doc.getTextWidth(etiqueta)
    doc.setFont('helvetica', 'normal')
    doc.text(valor, x + ancho + 1.2, y)
  }

  // ── Encabezado ─────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(d.emisor.razonSocial, X0, 18)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  let y = 24
  for (const l of [
    d.emisor.domicilio ? `Domicilio: ${d.emisor.domicilio}` : '',
    d.emisor.telefono || d.emisor.email ? `Tel.: ${d.emisor.telefono}  Email: ${d.emisor.email}` : '',
    d.emisor.condicionIva ? `Condición frente al IVA: ${d.emisor.condicionIva}` : '',
  ].filter(Boolean)) {
    doc.text(l, X0, y)
    y += 4.6
  }

  // Letra X en recuadro, como el casillero de los comprobantes.
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.4)
  doc.rect(98, 10, 14, 14)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(d.letra, 105, 20, { align: 'center' })

  doc.setFontSize(15)
  doc.text(d.titulo, XD + 42, 18, { align: 'center' })

  doc.setFontSize(7.5)
  campo('Punto de venta - Nro . comp.:', d.numero ?? 'SIN NÚMERO', XD, 27)
  campo('Fecha de emisión:', fecha(d.fechaEmision), XD, 33)
  if (d.emisor.cuit) campo('CUIT:', d.emisor.cuit, XD, 41)
  if (d.emisor.ingresosBrutos) campo('Ingresos brutos:', d.emisor.ingresosBrutos, XD, 47)
  if (d.emisor.inicioActividad) campo('Fecha de inicio de actividades:', d.emisor.inicioActividad, XD, 53)

  // Leyenda, destacada, debajo del encabezado.
  doc.setFillColor(245, 245, 245)
  doc.rect(X0, 58, X1 - X0, 7, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text(d.leyenda, (X0 + X1) / 2, 62.6, { align: 'center' })

  // ── Cliente ────────────────────────────────────────────────────────────────
  barra('Información del cliente', 69)
  campo('Razón social:', d.cliente.razonSocial, X0, 81)
  campo('CUIT:', d.cliente.cuit, 152, 81)
  campo('Condición frente al IVA:', d.cliente.condicionIva, X0, 87)
  campo('Domicilio:', d.cliente.domicilio, XD, 87)
  campo('Condicion de venta:', d.cliente.condicionVenta, X0, 93)
  campo('Vendedor:', d.cliente.vendedor, XD, 93)
  linea(97)

  // ── Detalle ────────────────────────────────────────────────────────────────
  const DET_Y = 101
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
  doc.setFont('helvetica', 'normal')
  for (const r of d.renglones) {
    doc.text(r.descripcion, X0, y)
    doc.text(`${cant(r.cantidad)} UNI`, 140, y, { align: 'right' })
    doc.text(r.precioUnitario.toFixed(2), 168, y, { align: 'right' })
    doc.text(money(r.total), X1 - 2.5, y, { align: 'right' })
    y += 5
  }

  // ── Total ──────────────────────────────────────────────────────────────────
  const RES_Y = Math.max(y + 4, 140)
  barra('Resumen', RES_Y)
  const RX0 = 117
  const fy = RES_Y + 13
  doc.setFillColor(...color)
  doc.rect(RX0, fy - 4, X1 - RX0, 7.5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text('Total', RX0 + 2, fy + 1)
  doc.text(money(d.total), X1 - 2, fy + 1, { align: 'right' })
  doc.setTextColor(0, 0, 0)

  // ── Pie: firma del cliente ─────────────────────────────────────────────────
  const PIE_Y = 240
  linea(PIE_Y - 6)
  barra('Conformidad del cliente', PIE_Y - 4)
  if (d.firma) {
    try {
      doc.addImage(d.firma.dataUrl, 'PNG', X0 + 2, PIE_Y + 5, 60, 22)
    } catch { /* una firma corrupta no tiene que tirar el comprobante */ }
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.2)
    doc.line(X0 + 2, PIE_Y + 28, X0 + 62, PIE_Y + 28)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(`Firma: ${d.firma.aclaracion || 'cliente'}`, X0 + 2, PIE_Y + 32)
  } else {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text('Sin firma registrada.', X0 + 2, PIE_Y + 8)
  }

  doc.setFontSize(6.5)
  doc.text(d.leyenda, XD, PIE_Y + 10, { maxWidth: X1 - XD })
  doc.setFontSize(7)
  doc.text('1', 105, 285, { align: 'center' })

  if (opts.descargar === false) return doc.output('blob')
  doc.save(d.archivo)
}
