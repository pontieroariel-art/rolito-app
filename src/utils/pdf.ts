import { Order } from '../types'
import { toDateStr } from './helpers'

// El logo fuente (/logo-rolito.png) es un PNG de 8334x2836px — insertado tal
// cual con doc.addImage(), jsPDF lo reincrusta a resolución completa (el PDF
// final termina pesando decenas de MB para un logo que se imprime a 48x16mm).
// Se reescala acá a un ancho de impresión razonable antes de convertir a
// base64, así el PDF queda liviano sin perder nitidez en el encabezado.
async function fetchImageAsBase64(url: string, maxWidth = 600): Promise<string | null> {
  try {
    const resp   = await fetch(url)
    const blob   = await resp.blob()
    const bitmap = await createImageBitmap(blob)
    const scale  = Math.min(1, maxWidth / bitmap.width)
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

function productTotals(orders: Order[]): string {
  const map: Record<string, number> = {}
  orders.forEach((o) =>
    o.products.forEach((p) => {
      map[p.name] = (map[p.name] ?? 0) + p.quantity
    }),
  )
  return Object.entries(map)
    .map(([name, qty]) => `${name}: ${qty}`)
    .join('   |   ')
}

export async function generateHojaDeRuta(
  orders: Order[],
  driverName: string,
  date: Date = new Date(),
) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  const dateStr = date.toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  // ── Logo ────────────────────────────────────────────────────────────────────
  const logo = await fetchImageAsBase64('/logo-rolito.png')
  if (logo) {
    doc.addImage(logo, 'PNG', 14, 8, 48, 16)
  }

  // ── Título ──────────────────────────────────────────────────────────────────
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text('Hoja de Ruta', pageW - 14, 14, { align: 'right' })

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  doc.text(`Chofer: ${driverName}`, pageW - 14, 20, { align: 'right' })
  doc.text(dateStr, pageW - 14, 25, { align: 'right' })
  doc.setTextColor(0)

  // ── Línea separadora ────────────────────────────────────────────────────────
  doc.setDrawColor(45, 106, 79)
  doc.setLineWidth(0.6)
  doc.line(14, 30, pageW - 14, 30)

  // ── Tabla ───────────────────────────────────────────────────────────────────
  // Cada producto de un pedido se renderiza en su propia fila; #, Cliente, Teléfono,
  // Dirección y Notas se combinan verticalmente (rowSpan) sobre las filas del pedido.
  type CellSpec = string | { content: string; rowSpan: number; styles?: Record<string, unknown> }
  const rows: CellSpec[][] = []
  orders.forEach((o, i) => {
    const products = o.products.length ? o.products : [{ name: '—', quantity: 0 }]
    products.forEach((p, pi) => {
      if (pi === 0) {
        rows.push([
          { content: String(i + 1), rowSpan: products.length, styles: { valign: 'middle' } },
          { content: o.clientName || '—', rowSpan: products.length, styles: { valign: 'middle' } },
          { content: o.clientPhone || '—', rowSpan: products.length, styles: { valign: 'middle' } },
          { content: o.clientAddress || '—', rowSpan: products.length, styles: { valign: 'middle' } },
          p.name,
          p.quantity ? String(p.quantity) : '',
          { content: o.notes || '', rowSpan: products.length, styles: { valign: 'middle' } },
        ])
      } else {
        rows.push([p.name, p.quantity ? String(p.quantity) : ''])
      }
    })
  })

  autoTable(doc, {
    startY: 34,
    head: [['#', 'Cliente', 'Teléfono', 'Dirección', 'PRODUCTO', 'CANTIDAD', 'Notas']],
    body: rows,
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor:  [45, 106, 79],
      textColor:  255,
      fontStyle:  'bold',
      fontSize:   8,
    },
    alternateRowStyles: { fillColor: [240, 248, 244] },
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center' },
      1: { cellWidth: 32 },
      2: { cellWidth: 24 },
      3: { cellWidth: 40 },
      4: { cellWidth: 34 },
      5: { cellWidth: 18, halign: 'center' },
      6: { cellWidth: 22 },
    },
    margin: { left: 14, right: 14 },
  })

  // ── Resumen final ───────────────────────────────────────────────────────────
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  const finalY: number = doc.lastAutoTable?.finalY ?? 34 + rows.length * 10

  doc.setDrawColor(200)
  doc.setLineWidth(0.3)
  doc.line(14, finalY + 4, pageW - 14, finalY + 4)

  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text(`Total de entregas: ${orders.length}`, 14, finalY + 10)

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(60)
  const summary = productTotals(orders)
  if (summary) {
    doc.text('Productos: ' + summary, 14, finalY + 16)
  }

  // ── Guardar ─────────────────────────────────────────────────────────────────
  const slug     = driverName.toLowerCase().replace(/\s+/g, '-')
  const dateSlug = toDateStr(date)
  doc.save(`hoja-de-ruta-${slug}-${dateSlug}.pdf`)
}

export interface HistorialDespachoRow {
  chofer:    string
  camion:    string | null
  cliente:   string
  direccion: string
  resultado: string   // ya formateado: 'Entregado' | 'No entregado' | 'Cancelado' | 'Pendiente'
  motivo?:   string
}

const RESULTADO_COLOR: Record<string, [number, number, number]> = {
  Entregado:     [29, 158, 117],
  'No entregado': [217, 119, 6],
  Cancelado:     [220, 38, 38],
  Pendiente:     [120, 120, 120],
}

// `scope`: si se pasa, el PDF queda acotado a un solo chofer/despacho — el
// encabezado muestra su nombre y camión (en vez del listado de todos), y la
// tabla deja de repetir esas dos columnas en cada fila (ya redundantes).
export async function generateHistorialDespachoPdf(
  rows:    HistorialDespachoRow[],
  fechaLabel: string,   // ya formateada, ej. "martes, 28 de julio"
  fechaSlug:  string,   // 'yyyy-MM-dd', para el nombre de archivo
  stats: { total: number; entregados: number; noEntregados: number },
  scope?: { chofer: string; camion: string | null },
) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  // ── Logo ────────────────────────────────────────────────────────────────────
  const logo = await fetchImageAsBase64('/logo-rolito.png')
  if (logo) {
    doc.addImage(logo, 'PNG', 14, 8, 48, 16)
  }

  // ── Título ──────────────────────────────────────────────────────────────────
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text('Historial de despacho', pageW - 14, 14, { align: 'right' })

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  const fechaCapitalizada = fechaLabel.charAt(0).toUpperCase() + fechaLabel.slice(1)
  const subtitulo = scope
    ? `${scope.chofer}${scope.camion ? ` · ${scope.camion}` : ''} — ${fechaCapitalizada}`
    : fechaCapitalizada
  doc.text(subtitulo, pageW - 14, 20, { align: 'right' })

  const pct = stats.total > 0 ? Math.round((stats.entregados / stats.total) * 100) : 0
  doc.text(
    `Total: ${stats.total}   ·   Entregados: ${stats.entregados}   ·   No entregados: ${stats.noEntregados}   ·   Cumplimiento: ${pct}%`,
    pageW - 14, 25, { align: 'right' },
  )
  doc.setTextColor(0)

  // ── Línea separadora ────────────────────────────────────────────────────────
  doc.setDrawColor(45, 106, 79)
  doc.setLineWidth(0.6)
  doc.line(14, 30, pageW - 14, 30)

  // ── Tabla ───────────────────────────────────────────────────────────────────
  const head = scope
    ? ['Cliente', 'Dirección', 'Resultado', 'Motivo']
    : ['Chofer', 'Camión', 'Cliente', 'Dirección', 'Resultado', 'Motivo']
  const body = rows.map((r) => scope
    ? [r.cliente, r.direccion, r.resultado, r.motivo ?? '']
    : [r.chofer, r.camion ?? '—', r.cliente, r.direccion, r.resultado, r.motivo ?? ''])
  const resultadoCol = scope ? 2 : 4

  autoTable(doc, {
    startY: 34,
    head: [head],
    body,
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor:  [45, 106, 79],
      textColor:  255,
      fontStyle:  'bold',
      fontSize:   8,
    },
    alternateRowStyles: { fillColor: [240, 248, 244] },
    columnStyles: scope
      ? { 0: { cellWidth: 60 }, 1: { cellWidth: 90 }, 2: { cellWidth: 30 }, 3: { cellWidth: 60 } }
      : { 0: { cellWidth: 38 }, 1: { cellWidth: 38 }, 2: { cellWidth: 50 }, 3: { cellWidth: 70 }, 4: { cellWidth: 28 }, 5: { cellWidth: 40 } },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === resultadoCol) {
        const color = RESULTADO_COLOR[String(data.cell.raw)]
        if (color) {
          data.cell.styles.textColor = color
          data.cell.styles.fontStyle = 'bold'
        }
      }
    },
  })

  // ── Guardar ─────────────────────────────────────────────────────────────────
  const suffix = scope ? `-${scope.chofer.toLowerCase().replace(/\s+/g, '-')}` : ''
  doc.save(`historial-despacho${suffix}-${fechaSlug}.pdf`)
}
