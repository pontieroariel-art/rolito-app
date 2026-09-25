import type { jsPDF } from 'jspdf'
import type { EmpresaTango, Sobre } from '@/types'
import { formatoARS } from './money'
import type { DocA4 } from './pdfBase'
import type { BloqueActa, SeccionActa } from './actaComoPantalla'

// El acta dibujada como la pantalla de Liquidación de caja (2026-09-24,
// pedido de Ariel: "la misma estructura visual y todo"): tarjetas blancas con
// borde, sin barras verdes; la tarjeta del cajón con Efectivo/Cheques y las
// dos cajas por empresa; y cada bloque como una tarjeta con su título a la
// izquierda y tres columnas (rótulo chico arriba, importe abajo) a la derecha,
// con los renglones separados por líneas finas. Solo dibujo: los datos los
// arma utils/actaComoPantalla.ts.

const X = 14
const ANCHO = 182
const BORDE: [number, number, number] = [184, 181, 168]      // #B8B5A8 (los recuadros de la pantalla)
const BORDE_SUAVE: [number, number, number] = [211, 209, 199] // #D3D1C7
const SEPARADOR: [number, number, number] = [231, 229, 220]  // #E7E5DC
const TINTA: [number, number, number] = [17, 24, 39]
const SECUNDARIO: [number, number, number] = [107, 106, 98]
const ROJO: [number, number, number] = [153, 27, 27]
const COLOR_EMPRESA: Record<EmpresaTango, [number, number, number]> = { redonhielo: [20, 83, 140], rolito: [91, 33, 182] }
const NOMBRE: Record<EmpresaTango, string> = { redonhielo: 'REDONHIELO', rolito: 'ROLITO' }
/** Anchos de las tres columnas de importe (Redonhielo · Rolito · Total), de izquierda a derecha. */
const COLS = [30, 30, 34]

const importe = (n: number | null | undefined, resta = false): string => (n == null || n === 0 ? '—' : resta ? `-${formatoARS(n)}` : formatoARS(n))

function texto(doc: jsPDF, s: string, x: number, y: number, o: { size: number; bold?: boolean; italic?: boolean; color?: [number, number, number]; align?: 'left' | 'right' | 'center' }): void {
  doc.setFontSize(o.size)
  doc.setFont('helvetica', o.bold ? 'bold' : o.italic ? 'italic' : 'normal')
  doc.setTextColor(...(o.color ?? TINTA))
  doc.text(s, x, y, { align: o.align ?? 'left' })
}

function borde(doc: jsPDF, x: number, y: number, w: number, h: number, color: [number, number, number] = BORDE_SUAVE, grosor = 0.3): void {
  doc.setDrawColor(...color)
  doc.setLineWidth(grosor)
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'S')
}

function linea(doc: jsPDF, x1: number, x2: number, y: number, color: [number, number, number] = SEPARADOR, grosor = 0.25): void {
  doc.setDrawColor(...color)
  doc.setLineWidth(grosor)
  doc.line(x1, y, x2, y)
}

/** La tarjeta del cajón: título centrado, Efectivo y Cheques, y las dos cajas por empresa. */
export function tarjetaCajon(base: Pick<DocA4, 'doc'>, y: number, s: Sobre, cajon: Record<EmpresaTango, { efectivo: number; cheques: number; nCheques: number; total: number }> | null): number {
  const { doc } = base
  const chTotal = s.sistema.cheques.reduce((x, c) => x + c.importe, 0)
  const y0 = y
  const xi = X + 4, xd = X + ANCHO - 4
  y += 8
  texto(doc, `Liquidación de ${s.firmanteRinde}`, X + ANCHO / 2, y, { size: 11.5, bold: true, align: 'center' })
  y += 3.5
  linea(doc, xi, xd, y, BORDE, 0.5)
  y += 7
  texto(doc, 'Efectivo', xi, y, { size: 10, bold: true })
  texto(doc, formatoARS(s.sistema.efectivo), xd, y, { size: 13, bold: true, align: 'right' })
  y += 7
  texto(doc, 'Cheques', xi, y, { size: 10, bold: true })
  texto(doc, formatoARS(chTotal), xd, y, { size: 13, bold: true, align: 'right' })
  y += 5
  if (cajon) {
    const gap = 4
    const w = (ANCHO - 8 - gap) / 2
    const alto = 28
    const caja = (e: EmpresaTango, x: number) => {
      borde(doc, x, y, w, alto, BORDE, 0.5)
      const a = x + 3, b = x + w - 3
      let yy = y + 5.5
      texto(doc, NOMBRE[e], x + w / 2, yy, { size: 8.5, bold: true, color: COLOR_EMPRESA[e], align: 'center' })
      yy += 6
      texto(doc, 'Efectivo', a, yy, { size: 8.5, bold: true })
      texto(doc, formatoARS(cajon[e].efectivo), b, yy, { size: 9, bold: true, align: 'right' })
      yy += 5
      texto(doc, cajon[e].nCheques ? `Cheques · ${cajon[e].nCheques}` : 'Cheques', a, yy, { size: 8.5, bold: true })
      texto(doc, formatoARS(cajon[e].cheques), b, yy, { size: 9, bold: true, align: 'right' })
      yy += 2.5
      linea(doc, a, b, yy, BORDE, 0.5)
      yy += 4.5
      texto(doc, 'Total', a, yy, { size: 8.5, bold: true })
      texto(doc, formatoARS(cajon[e].total), b, yy, { size: 9.5, bold: true, align: 'right' })
    }
    caja('redonhielo', X + 4)
    caja('rolito', X + 4 + w + gap)
    y += alto
  }
  y += 4
  borde(doc, X, y0, ANCHO, y - y0, BORDE_SUAVE, 0.4)
  return y + 5
}

/** Un bloque como en la pantalla: tarjeta con título y tres columnas arriba, renglones abajo. */
function tarjetaBloque(base: Pick<DocA4, 'doc' | 'autoTable' | 'pageH'>, y: number, b: BloqueActa): number {
  const { doc, autoTable, pageH } = base
  const filas = b.filas.length ? b.filas : null
  const altoEstimado = 13 + (filas ? filas.reduce((s, f) => s + (f.texto.length > 70 ? 9 : 6.5), 0) : 7)
  if (y + Math.min(altoEstimado, 60) > pageH - 18) { doc.addPage(); y = 20 }
  const y0 = y
  const xi = X + 3, xd = X + ANCHO - 3
  // Encabezado: título y cantidad a la izquierda; a la derecha los tres rótulos con su importe.
  texto(doc, b.titulo, xi, y + 6, { size: 9.5, bold: true })
  const wTitulo = doc.getTextWidth(b.titulo)
  if (b.cantidad) texto(doc, String(b.cantidad), xi + wTitulo + 1.5, y + 6, { size: 8, color: SECUNDARIO })
  const derecha = [xd - COLS[1]! - COLS[2]!, xd - COLS[2]!, xd]
  const rotulos: [string, [number, number, number], number][] = [
    ['REDONHIELO', COLOR_EMPRESA.redonhielo, b.redonhielo], ['ROLITO', COLOR_EMPRESA.rolito, b.rolito], ['TOTAL', SECUNDARIO, b.total],
  ]
  rotulos.forEach(([rotulo, color, n], i) => {
    texto(doc, rotulo, derecha[i]!, y + 4, { size: 6.5, bold: true, color, align: 'right' })
    texto(doc, importe(n, b.resta), derecha[i]!, y + 8.5, { size: 9, bold: i === 2, color: b.resta && n ? ROJO : TINTA, align: 'right' })
  })
  y += 11
  linea(doc, X, xd + 3, y, SEPARADOR)
  // Renglones.
  const body: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = filas
    ? filas.map((f) => [f.texto, importe(f.redonhielo, f.resta), importe(f.rolito, f.resta), f.total != null ? importe(f.total) : ''])
    : [[{ content: b.vacio, colSpan: 4, styles: { textColor: SECUNDARIO, fontStyle: 'italic' } }]]
  const anchoTexto = ANCHO - 6 - COLS[0]! - COLS[1]! - COLS[2]!
  autoTable(doc, {
    startY: y + 0.5,
    body,
    theme: 'plain',
    styles: { fontSize: 7.8, cellPadding: { top: 1.7, bottom: 1.7, left: 1, right: 1 }, textColor: TINTA, overflow: 'linebreak' },
    columnStyles: { 0: { cellWidth: anchoTexto }, 1: { cellWidth: COLS[0], halign: 'right' }, 2: { cellWidth: COLS[1], halign: 'right' }, 3: { cellWidth: COLS[2], halign: 'right' } },
    margin: { left: xi, right: X + 3 },
    didParseCell: (data) => {
      const f = filas?.[data.row.index]
      if (String(data.cell.raw).startsWith('-')) data.cell.styles.textColor = ROJO
      if (String(data.cell.raw) === '—') data.cell.styles.textColor = [168, 166, 156]
      if (f?.tachado) data.cell.styles.textColor = [150, 150, 150]
    },
    didDrawCell: (data) => {
      if (data.column.index === data.table.columns.length - 1 && data.row.index < body.length - 1) {
        linea(doc, xi, xd, data.cell.y + data.cell.height, SEPARADOR)
      }
    },
  })
  const fin = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 7
  const yFin = fin + 1.5
  borde(doc, X, y0, ANCHO, yFin - y0, BORDE_SUAVE, 0.4)
  return yFin + 4
}

/** Las secciones de la pantalla, una debajo de la otra. Devuelve la `y` final. */
export function dibujarSecciones(base: Pick<DocA4, 'doc' | 'autoTable' | 'pageH'>, y: number, secciones: SeccionActa[]): number {
  const { doc, pageH } = base
  for (const sec of secciones) {
    if (y > pageH - 40) { doc.addPage(); y = 20 }
    texto(doc, sec.titulo, X, y + 2, { size: 7.5, bold: true, color: SECUNDARIO })
    y += 5.5
    for (const b of sec.bloques) y = tarjetaBloque(base, y, b)
    y += 2
  }
  return y
}
