// Papel común de los comprobantes internos de la venta del camión: la factura
// de promo (X), el remito de promo (X) y el remito oficial de Redonhielo (R).
//
// Copia el formato del talonario de PROMOCIÓN que usaba la empresa (foto del
// 2026-09-03): cabecera "FÁBRICA DE HIELO" (promo) o los datos del emisor
// (Redonhielo), casillero de letra con "Código Nº", título y número a la
// derecha, bloque SEÑOR(ES) con código de cliente y vendedor, renglón
// "Remitos - O/C", tabla DESCRIPCIÓN / UM / CANTIDAD / P.UNIT. / % DTO. /
// IMPORTE, marca de agua "GRACIAS POR SU COMPRA", TOTAL PESOS y SON PESOS, y
// al pie el CAI (o el número de control interno) con la firma del cliente.
//
// El remito usa el mismo papel sin las columnas de precio y con el total en
// bultos. Todo se dibuja con jsPDF a mano: sin imágenes, así el PDF se arma
// offline en el teléfono del chofer.

import type { jsPDF } from 'jspdf'
import { importeEnLetras } from './facturaPdf'

export interface RenglonPapel {
  descripcion:     string
  um:              string
  cantidad:        number
  precioUnitario?: number
  dtoPct?:         number
  importe?:        number
  /** Texto chico a la derecha de la descripción (ej. "cambio sin cargo"). */
  nota?:           string
}

export interface PapelInternoSpec {
  encabezado: {
    /** "FÁBRICA DE HIELO" (promo) o la razón social del emisor. */
    titulo:    string
    subtitulo?: string
    lineas:    string[]
  }
  letra:          string
  /** Lo que va debajo de la letra: "Código Nº: 00" / "Cód. 91". */
  codigoLetra:    string
  tituloDocumento: string
  numero:         string
  fecha:          string
  cliente: {
    nombre:         string
    domicilio:      string
    localidadCp:    string
    condicionIva:   string
    codigo:         string
    cuit:           string
    vendedor:       string
    condicionVenta: string
  }
  remitosOc?:     string
  conPrecios:     boolean
  renglones:      RenglonPapel[]
  /** Con precios: TOTAL PESOS + SON PESOS. */
  total?:         number
  /** Sin precios: total en bultos. */
  totalBultos?:   { entregados: number; cambios: number }
  marcaAgua?:     string
  pie: {
    lineas:   string[]
    leyenda:  string
  }
  firma?:         { dataUrl: string; aclaracion: string }
}

const X0 = 12
const X1 = 198
const NEGRO: [number, number, number] = [0, 0, 0]
const GRIS: [number, number, number] = [110, 110, 110]

/** "92000,00": coma decimal, sin separador de miles — como el talonario. */
export const pesos = (n: number) => n.toFixed(2).replace('.', ',')
export const cantidadPapel = (n: number) => n.toFixed(2).replace('.', ',')

export function dibujarPapelInterno(doc: jsPDF, s: PapelInternoSpec): void {
  const marco = (y0: number, y1: number) => {
    doc.setDrawColor(...NEGRO)
    doc.setLineWidth(0.35)
    doc.rect(X0, y0, X1 - X0, y1 - y0)
  }
  const etiqueta = (texto: string, valor: string, x: number, y: number, tam = 8, xValor?: number) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(tam)
    doc.text(texto, x, y)
    doc.setFont('helvetica', 'normal')
    const xv = xValor ?? x + doc.getTextWidth(texto) + 2.5
    doc.text(valor, xv, y, { maxWidth: X1 - 2 - xv })
  }

  // ── Encabezado ─────────────────────────────────────────────────────────────
  marco(10, 58)
  doc.setTextColor(...NEGRO)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(s.encabezado.titulo, X0 + 4, 28)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  let y = 34
  if (s.encabezado.subtitulo) { doc.text(s.encabezado.subtitulo, X0 + 4, y); y += 4.5 }
  for (const l of s.encabezado.lineas) { doc.text(l, X0 + 4, y); y += 4.5 }

  // Casillero de la letra, centrado, como en cualquier comprobante.
  doc.setLineWidth(0.4)
  doc.rect(97, 12, 16, 16)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text(s.letra, 105, 23.5, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text(s.codigoLetra, 105, 32, { align: 'center' })

  const XD = 120
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(s.tituloDocumento, XD, 22)
  doc.setFontSize(10)
  doc.text(`Nº: ${s.numero}`, XD, 29)
  etiqueta('Fecha:', s.fecha, XD, 36, 8.5, XD + 40)

  // ── Cliente ────────────────────────────────────────────────────────────────
  marco(60, 102)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('SEÑOR(ES):', X0 + 4, 68)
  doc.setFontSize(11)
  doc.text(s.cliente.nombre, X0 + 4, 75, { maxWidth: XD - X0 - 8 })
  etiqueta('Domicilio:', s.cliente.domicilio, X0 + 4, 84, 8)
  etiqueta('C.P.:', s.cliente.localidadCp, X0 + 4, 91, 8)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(s.cliente.condicionIva, X0 + 4, 97)

  etiqueta('Cliente Código:', s.cliente.codigo, XD, 84, 8, XD + 36)
  etiqueta('C.U.I.T.:', s.cliente.cuit, XD, 89, 8, XD + 36)
  etiqueta('Vendedor:', s.cliente.vendedor, XD, 94, 8, XD + 36)
  etiqueta('Condición de vta.:', s.cliente.condicionVenta, XD, 99, 8, XD + 36)

  // ── Remitos / O.C. ────────────────────────────────────────────────────────
  marco(104, 113)
  etiqueta('Remitos - O/C:', s.remitosOc ?? '', X0 + 4, 110, 8)

  // ── Detalle ────────────────────────────────────────────────────────────────
  const T0 = 117
  const T1 = 228
  marco(T0, T1)
  // Columnas (mm): con precios → desc | UM | CANT | P.UNIT | %DTO | IMPORTE
  const cols = s.conPrecios
    ? [X0, 104, 116, 138, 160, 174, X1]
    : [X0, 150, 166, X1]
  const titulos = s.conPrecios
    ? ['DESCRIPCION', 'UM', 'CANTIDAD', 'P.UNIT.', '% DTO.', 'IMPORTE']
    : ['DESCRIPCION', 'UM', 'CANTIDAD']
  const HEAD = T0 + 8
  doc.setLineWidth(0.35)
  doc.line(X0, HEAD, X1, HEAD)
  for (let i = 1; i < cols.length - 1; i++) doc.line(cols[i], T0, cols[i], T1)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  titulos.forEach((t, i) => {
    const izq = i === 0
    doc.text(t, izq ? cols[i] + 2 : (cols[i] + cols[i + 1]) / 2, T0 + 5.5, { align: izq ? 'left' : 'center' })
  })

  // Marca de agua: texto grande y translúcido sobre la tabla, como el sello
  // "GRACIAS POR SU COMPRA" del talonario.
  if (s.marcaAgua) {
    const palabras = s.marcaAgua.split(' ')
    const lineas = palabras.length >= 4
      ? [palabras.slice(0, 1).join(' '), palabras.slice(1, 3).join(' '), palabras.slice(3).join(' ')]
      : palabras
    const gs = doc.GState({ opacity: 0.13 })
    doc.setGState(gs)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(46)
    doc.setTextColor(...NEGRO)
    let wy = T0 + 42
    for (const l of lineas) { doc.text(l, (X0 + X1) / 2, wy, { align: 'center' }); wy += 26 }
    doc.setGState(doc.GState({ opacity: 1 }))
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...NEGRO)
  y = HEAD + 5
  for (const r of s.renglones) {
    if (y > T1 - 4) break   // más renglones que papel: no pasa con una venta de calle
    doc.text(r.descripcion, cols[0] + 2, y, { maxWidth: cols[1] - cols[0] - 4 })
    doc.text(r.um, (cols[1] + cols[2]) / 2, y, { align: 'center' })
    doc.text(cantidadPapel(r.cantidad), cols[3] - 2, y, { align: 'right' })
    if (s.conPrecios) {
      doc.text(pesos(r.precioUnitario ?? 0), cols[4] - 2, y, { align: 'right' })
      doc.text(r.dtoPct ? pesos(r.dtoPct) : '', cols[5] - 2, y, { align: 'right' })
      doc.text(pesos(r.importe ?? 0), cols[6] - 2, y, { align: 'right' })
    }
    if (r.nota) {
      doc.setFontSize(6.5)
      doc.setTextColor(...GRIS)
      doc.text(r.nota, cols[1] - 2, y, { align: 'right' })
      doc.setTextColor(...NEGRO)
      doc.setFontSize(8)
    }
    y += 5
  }

  // ── Totales ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  if (s.conPrecios && s.total !== undefined) {
    doc.text('TOTAL PESOS:', 150, 237, { align: 'right' })
    doc.text(pesos(s.total), X1 - 2, 237, { align: 'right' })
    doc.setFontSize(8.5)
    doc.text('SON PESOS:', X0 + 4, 245)
    doc.setFont('helvetica', 'normal')
    doc.text(importeEnLetras(s.total), X0 + 34, 245, { maxWidth: X1 - X0 - 38 })
  } else if (s.totalBultos) {
    doc.text('TOTAL BULTOS:', 150, 237, { align: 'right' })
    doc.text(String(s.totalBultos.entregados + s.totalBultos.cambios), X1 - 2, 237, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(`Entregados ${s.totalBultos.entregados} · Cambios sin cargo ${s.totalBultos.cambios}`, X0 + 4, 245)
  }

  // ── Pie: CAI / control a la izquierda, firma a la derecha ─────────────────
  marco(250, 282)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  let py = 257
  for (const l of s.pie.lineas) { doc.text(l, X0 + 4, py); py += 5 }
  if (s.firma) {
    try {
      doc.addImage(s.firma.dataUrl, 'PNG', 128, 252, 56, 20)
    } catch { /* una firma corrupta no tiene que tirar el comprobante */ }
    doc.setLineWidth(0.2)
    doc.line(126, 273, 194, 273)
    doc.setFontSize(7)
    doc.text(`Firma: ${s.firma.aclaracion || 'cliente'}`, 160, 277, { align: 'center' })
  } else {
    doc.setFontSize(7)
    doc.text('Sin firma registrada.', 160, 265, { align: 'center' })
  }

  doc.setFontSize(6.5)
  doc.setTextColor(...GRIS)
  doc.text(s.pie.leyenda, (X0 + X1) / 2, 287, { align: 'center', maxWidth: X1 - X0 })
  doc.setTextColor(...NEGRO)
}
