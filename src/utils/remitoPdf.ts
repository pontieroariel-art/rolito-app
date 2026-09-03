// PDF del remito de la venta del camión — Redonhielo (oficial, letra R con el
// CAI del talonario) y Rolito (mismo papel, letra X y número de control
// interno). Pensado desde la factura de ARCA para que el cliente reconozca el
// papel: mismo encabezado y barras verdes. Lo que cambia es el cuerpo: un
// remito no lleva precios, solo cantidades; suma el bloque de entrega
// (chofer, camión) y cierra con bultos en vez de importes. Firma del cliente al
// pie (decisión 2026-09-03).

import type { RemitoData } from './comprobanteInterno'

const VERDE: [number, number, number] = [23, 92, 63]
const GRIS_LINEA: [number, number, number] = [190, 190, 190]

const X0 = 12
const X1 = 198
const XD = 112

const cant  = (n: number) => n.toFixed(2)
const fecha = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`

export async function generateRemitoPdf(
  d: RemitoData,
  opts: { descargar?: boolean } = {},
): Promise<Blob | void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })

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
  const campo = (etiqueta: string, valor: string, x: number, y: number, tam = 7.5) => {
    doc.setFontSize(tam)
    doc.setFont('helvetica', 'bold')
    doc.text(etiqueta, x, y)
    const ancho = doc.getTextWidth(etiqueta)
    doc.setFont('helvetica', 'normal')
    doc.text(valor, x + ancho + 1.2, y)
  }

  // ── Encabezado (igual a la factura) ────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(d.emisor.razonSocial, X0, 18)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  let y = 24
  for (const l of [
    `Domicilio: ${d.emisor.domicilio}`,
    `Tel.: ${d.emisor.telefono}  Email: ${d.emisor.email}`,
    `Condición frente al IVA: ${d.emisor.condicionIva}`,
  ]) {
    doc.text(l, X0, y)
    y += 4.6
  }

  // Casillero de la letra, como en cualquier comprobante.
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.4)
  doc.rect(98, 10, 14, 14)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(d.letra, 105, 20, { align: 'center' })
  doc.setFontSize(5.5)
  doc.setFont('helvetica', 'normal')
  doc.text(d.letra === 'R' ? 'COD. 91' : 'NO FISCAL', 105, 23.2, { align: 'center' })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('REMITO', XD + 42, 18, { align: 'center' })

  doc.setFontSize(7.5)
  campo('Punto de venta - Nro . comp.:', d.numero ?? 'SIN NÚMERO', XD, 27)
  campo('Fecha de emisión:', fecha(d.fechaEmision), XD, 33)
  campo('CUIT:', d.emisor.cuit, XD, 41)
  campo('Ingresos brutos:', d.emisor.ingresosBrutos, XD, 47)
  campo('Fecha de inicio de actividades:', d.emisor.inicioActividad, XD, 53)

  // Leyenda debajo del encabezado. En el oficial es una línea discreta; en el
  // X va destacada porque es lo que lo distingue.
  if (d.letra === 'X') {
    doc.setFillColor(245, 245, 245)
    doc.rect(X0, 58, X1 - X0, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.text(d.leyenda, (X0 + X1) / 2, 62.6, { align: 'center' })
  } else {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(90, 90, 90)
    doc.text(d.leyenda, (X0 + X1) / 2, 62, { align: 'center' })
    doc.setTextColor(0, 0, 0)
  }

  // ── Cliente ────────────────────────────────────────────────────────────────
  barra('Información del cliente', 69)
  campo('Razón social:', d.cliente.razonSocial, X0, 81)
  campo('CUIT:', d.cliente.cuit, 152, 81)
  campo('Domicilio de entrega:', d.cliente.domicilio, X0, 87)
  campo('Condicion de venta:', d.cliente.condicionVenta, XD + 30, 87)
  linea(91)

  // ── Entrega (propio del remito) ────────────────────────────────────────────
  barra('Entrega', 95)
  campo('Entregado por:', d.entrega.chofer, X0, 107)
  if (d.entrega.camion) campo('Camión:', d.entrega.camion, XD, 107)
  campo('Fecha de entrega:', fecha(d.fechaEmision), XD + 45, 107)
  linea(111)

  // ── Detalle: cantidad y descripción, sin precios ───────────────────────────
  const DET_Y = 115
  barra('Detalle', DET_Y)
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Cant.', X0 + 22, DET_Y + 4.5, { align: 'right' })
  doc.text('Descripción', X0 + 28, DET_Y + 4.5)
  doc.setTextColor(0, 0, 0)

  y = DET_Y + 12
  doc.setFontSize(7.5)
  for (const r of d.renglones) {
    doc.setFont('helvetica', 'normal')
    doc.text(`${cant(r.cantidad)} UNI`, X0 + 22, y, { align: 'right' })
    doc.text(r.descripcion, X0 + 28, y)
    if (r.esCambio) {
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(90, 90, 90)
      doc.text('Cambio — sin cargo', X1 - 2.5, y, { align: 'right' })
      doc.setTextColor(0, 0, 0)
    }
    y += 5
  }

  // ── Resumen de bultos (en vez de importes) ─────────────────────────────────
  const RES_Y = Math.max(y + 4, 160)
  barra('Resumen', RES_Y)
  const RX0 = 117
  let fy = RES_Y + 12
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.setFillColor(238, 238, 238)
  doc.rect(RX0, fy - 3.6, X1 - RX0, 5.4, 'F')
  doc.text('Unidades entregadas', RX0 + 2, fy)
  doc.text(String(d.bultos.entregados), X1 - 2, fy, { align: 'right' })
  fy += 6
  doc.text('Cambios (sin cargo)', RX0 + 2, fy)
  doc.text(String(d.bultos.cambios), X1 - 2, fy, { align: 'right' })
  fy += 6
  doc.setFillColor(...VERDE)
  doc.rect(RX0, fy - 4, X1 - RX0, 7.5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text('Total de bultos', RX0 + 2, fy + 1)
  doc.text(String(d.bultos.entregados + d.bultos.cambios), X1 - 2, fy + 1, { align: 'right' })
  doc.setTextColor(0, 0, 0)

  // ── Pie: firma a la izquierda, control a la derecha ────────────────────────
  const PIE_Y = 240
  linea(PIE_Y - 6)
  barra('Conformidad del cliente', PIE_Y - 4, 6.5)

  if (d.firma) {
    try {
      doc.addImage(d.firma.dataUrl, 'PNG', X0 + 2, PIE_Y + 5, 60, 22)
    } catch { /* una firma corrupta no tiene que tirar el remito */ }
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

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  if (d.control.tipo === 'cai') {
    doc.text(`CAI Nº: ${d.control.cai}`, XD, PIE_Y + 5)
    doc.text(`Fecha vto. CAI: ${fecha(d.control.vencimiento)}`, XD, PIE_Y + 9.5)
  } else {
    doc.text(`Nº de control interno: ${d.control.codigo}`, XD, PIE_Y + 5)
  }
  doc.setFontSize(6.5)
  doc.setTextColor(90, 90, 90)
  doc.text(d.leyenda, XD, PIE_Y + 15, { maxWidth: X1 - XD })
  doc.setTextColor(0, 0, 0)

  doc.setFontSize(7)
  doc.text('1', 105, 285, { align: 'center' })

  if (opts.descargar === false) return doc.output('blob')
  doc.save(d.archivo)
}
