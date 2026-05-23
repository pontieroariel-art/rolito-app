import { Order } from '../types'

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.readAsDataURL(blob)
    })
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
  const rows = orders.map((o, i) => [
    String(i + 1),
    o.clientName || '—',
    o.clientPhone || '—',
    o.clientAddress || '—',
    o.products.map((p) => `${p.name} ×${p.quantity}`).join('\n'),
    o.notes || '',
    '',
  ])

  autoTable(doc, {
    startY: 34,
    head: [['#', 'Cliente', 'Teléfono', 'Dirección', 'Productos', 'Notas', 'Firma']],
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
      1: { cellWidth: 36 },
      2: { cellWidth: 26 },
      3: { cellWidth: 44 },
      4: { cellWidth: 36 },
      5: { cellWidth: 22 },
      6: { cellWidth: 18 },
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
  const dateSlug = date.toISOString().split('T')[0]
  doc.save(`hoja-de-ruta-${slug}-${dateSlug}.pdf`)
}
