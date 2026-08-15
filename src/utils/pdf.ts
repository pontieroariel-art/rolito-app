import { Order, OrderProduct } from '../types'
import { toDateStr } from './helpers'
import { ROLITO_INFO } from './constants'

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
  cantidad:  string          // productos entregados (o pedidos, si no se entregó), ya resumidos
  productos: OrderProduct[]  // mismos productos que `cantidad`, sin resumir — para el total del pie
  resultado: string          // ya formateado: 'Entregado' | 'No entregado' | 'Cancelado' | 'Pendiente'
  hora?:     string          // hora de entrega, solo si resultado === 'Entregado'
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
    ? ['Cliente', 'Dirección', 'Cantidad', 'Resultado', 'Hora', 'Motivo']
    : ['Chofer', 'Camión', 'Cliente', 'Dirección', 'Cantidad', 'Resultado', 'Hora', 'Motivo']
  const body = rows.map((r) => scope
    ? [r.cliente, r.direccion, r.cantidad, r.resultado, r.hora ?? '', r.motivo ?? '']
    : [r.chofer, r.camion ?? '—', r.cliente, r.direccion, r.cantidad, r.resultado, r.hora ?? '', r.motivo ?? ''])
  const resultadoCol = scope ? 3 : 5

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
      ? { 0: { cellWidth: 45 }, 1: { cellWidth: 60 }, 2: { cellWidth: 50 }, 3: { cellWidth: 28 }, 4: { cellWidth: 18 }, 5: { cellWidth: 45 } }
      : { 0: { cellWidth: 30 }, 1: { cellWidth: 30 }, 2: { cellWidth: 38 }, 3: { cellWidth: 48 }, 4: { cellWidth: 40 }, 5: { cellWidth: 24 }, 6: { cellWidth: 16 }, 7: { cellWidth: 28 } },
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

  // ── Resumen final ───────────────────────────────────────────────────────────
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  const finalY: number = doc.lastAutoTable?.finalY ?? 34 + rows.length * 8

  doc.setDrawColor(200)
  doc.setLineWidth(0.3)
  doc.line(14, finalY + 4, pageW - 14, finalY + 4)

  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text(`Total de pedidos: ${stats.total}   ·   Entregados: ${stats.entregados}   ·   No entregados: ${stats.noEntregados}`, 14, finalY + 10)

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(60)
  const productMap: Record<string, number> = {}
  rows.forEach((r) => {
    if (r.resultado !== 'Entregado') return
    r.productos.forEach((p) => { productMap[p.name] = (productMap[p.name] ?? 0) + p.quantity })
  })
  const productSummary = Object.entries(productMap).map(([name, qty]) => `${name}: ${qty}`).join('   |   ')
  if (productSummary) {
    doc.text('Descargado en total: ' + productSummary, 14, finalY + 16)
  }

  // ── Guardar ─────────────────────────────────────────────────────────────────
  const suffix = scope ? `-${scope.chofer.toLowerCase().replace(/\s+/g, '-')}` : ''
  doc.save(`historial-despacho${suffix}-${fechaSlug}.pdf`)
}

// Remito de traslado (pág. 1) + comodato (pág. 2) en un solo PDF, generados
// juntos porque comparten número de movimiento y se imprimen/archivan como
// una unidad. El texto del comodato es un modelo genérico de préstamo de
// uso — no reemplaza una revisión legal/contable si la empresa quiere
// ajustar cláusulas.
export async function generateRemitoComodato(params: {
  numero:       number
  tipo:         'asignacion' | 'retiro'
  fecha:        Date
  heladera:     { codigoInterno: string; modelo: string; numeroSerie: string }
  cliente:      { razonSocial: string; cuit: string; direccion: string }
  firmaDataUrl: string
  actorNombre:  string
}) {
  const { numero, tipo, fecha, heladera, cliente, firmaDataUrl, actorNombre } = params
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')

  const fechaStr = fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
  const tipoLabel = tipo === 'asignacion' ? 'Entrega' : 'Retiro'

  const header = (titulo: string) => {
    if (logo) doc.addImage(logo, 'PNG', 14, 8, 40, 13)
    doc.setFontSize(15)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0)
    doc.text(titulo, pageW - 14, 14, { align: 'right' })
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80)
    doc.text(`N° ${numero}   ·   ${fechaStr}`, pageW - 14, 20, { align: 'right' })
    doc.setTextColor(0)
    doc.setDrawColor(45, 106, 79)
    doc.setLineWidth(0.6)
    doc.line(14, 26, pageW - 14, 26)
  }

  const datosPartes = (startY: number) => {
    autoTable(doc, {
      startY,
      theme: 'plain',
      body: [
        ['De',   `${ROLITO_INFO.razonSocial} — ${ROLITO_INFO.direccion}, ${ROLITO_INFO.localidad} (CP ${ROLITO_INFO.cp})`],
        ['A',    `${cliente.razonSocial} — CUIT ${cliente.cuit}`],
        ['Domicilio', cliente.direccion || '—'],
      ],
      styles: { fontSize: 9, cellPadding: 1.5 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 28 } },
      margin: { left: 14, right: 14 },
    })
    // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
    return doc.lastAutoTable?.finalY ?? startY + 20
  }

  const tablaEquipo = (startY: number) => {
    autoTable(doc, {
      startY,
      head: [['Código', 'Modelo', 'N° de serie']],
      body: [[heladera.codigoInterno, heladera.modelo, heladera.numeroSerie]],
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      margin: { left: 14, right: 14 },
    })
    // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
    return doc.lastAutoTable?.finalY ?? startY + 20
  }

  const firmaYAclaracion = (y: number) => {
    doc.addImage(firmaDataUrl, 'PNG', 14, y, 60, 22)
    doc.setDrawColor(150)
    doc.setLineWidth(0.2)
    doc.line(14, y + 24, 90, y + 24)
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text('Firma del cliente', 14, y + 28)
    doc.setFontSize(8.5)
    doc.setTextColor(60)
    doc.text(`Registró: ${actorNombre}`, pageW - 14, y + 28, { align: 'right' })
  }

  // ── Página 1: remito ──────────────────────────────────────────────────────
  header(`Remito de Traslado — ${tipoLabel}`)
  let y = datosPartes(32)
  y = tablaEquipo(y + 6)
  doc.setFontSize(9)
  doc.setTextColor(60)
  doc.text(
    tipo === 'asignacion'
      ? 'Se traslada el equipo detallado arriba al domicilio del cliente.'
      : 'Se retira el equipo detallado arriba del domicilio del cliente.',
    14, y + 10,
  )
  firmaYAclaracion(y + 20)

  // ── Página 2: comodato ────────────────────────────────────────────────────
  doc.addPage()
  header('Contrato de Comodato')
  y = datosPartes(32)

  doc.setFontSize(9)
  doc.setTextColor(30)
  const parrafos = [
    `Entre ${ROLITO_INFO.razonSocial} (en adelante "EL COMODANTE") y ${cliente.razonSocial}, ` +
    `CUIT ${cliente.cuit} (en adelante "EL COMODATARIO"), se conviene el préstamo de uso gratuito ` +
    `del equipo detallado a continuación.`,
    '1. Objeto: el equipo permanece en todo momento en propiedad de EL COMODANTE. EL COMODATARIO ' +
    'lo recibe en préstamo de uso, sin cargo, para la conservación y venta de los productos de EL COMODANTE.',
    '2. Uso: EL COMODATARIO se compromete a darle al equipo el uso exclusivo previsto y a mantenerlo ' +
    'en buen estado de funcionamiento y conservación.',
    '3. Responsabilidad: cualquier daño, pérdida o rotura del equipo durante la vigencia del préstamo ' +
    'es responsabilidad de EL COMODATARIO, salvo desgaste normal por uso.',
    '4. Devolución: EL COMODATARIO se obliga a restituir el equipo en buen estado a simple ' +
    'requerimiento de EL COMODANTE, o al finalizar la relación comercial entre las partes.',
  ]
  let ty = y + 8
  parrafos.forEach((p) => {
    const lines = doc.splitTextToSize(p, pageW - 28)
    doc.text(lines, 14, ty)
    ty += lines.length * 4.2 + 3
  })

  y = tablaEquipo(ty + 2)
  firmaYAclaracion(y + 10)

  // ── Guardar ─────────────────────────────────────────────────────────────────
  doc.save(`remito-comodato-${numero}-${toDateStr(fecha)}.pdf`)
}

// Hoja para entregarle al técnico/chofer con lo que necesita saber del
// pedido de reparación: quién es el cliente, dónde queda, y qué equipo es.
export async function generatePedidoReparacion(params: {
  ticket: {
    numero:       number
    motivoNombre: string
    fechaPedido:  Date
    estado:       string
  }
  heladera: {
    codigoInterno: string
    modelo:        string
    numeroSerie:   string
    medidas?:      { ancho: number; alto: number; profundo: number }
    fotoUrl?:      string
  }
  cliente: {
    razonSocial:   string
    cuit:          string
    codigoCliente?: string
    direccion:     string
    localidad?:    string
  }
}) {
  const { ticket, heladera, cliente } = params
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')
  const fotoHeladera = heladera.fotoUrl ? await fetchImageAsBase64(heladera.fotoUrl, 300) : null

  if (logo) doc.addImage(logo, 'PNG', 14, 8, 40, 13)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text('Pedido de Reparación', pageW - 14, 14, { align: 'right' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  const fechaStr = ticket.fechaPedido.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
  doc.text(`N° ${ticket.numero}   ·   ${fechaStr}`, pageW - 14, 20, { align: 'right' })
  doc.setTextColor(0)
  doc.setDrawColor(45, 106, 79)
  doc.setLineWidth(0.6)
  doc.line(14, 26, pageW - 14, 26)

  autoTable(doc, {
    startY: 32,
    theme: 'plain',
    body: [
      ['Cliente',    cliente.razonSocial],
      ['CUIT',       cliente.cuit || '—'],
      ['Código',     cliente.codigoCliente || '—'],
      ['Domicilio',  `${cliente.direccion || '—'}${cliente.localidad ? `, ${cliente.localidad}` : ''}`],
      ['Motivo',     ticket.motivoNombre],
    ],
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 28 } },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  let y = doc.lastAutoTable?.finalY ?? 60

  autoTable(doc, {
    startY: y + 6,
    head: [['Código', 'Modelo', 'N° de serie', 'Medidas']],
    body: [[
      heladera.codigoInterno,
      heladera.modelo,
      heladera.numeroSerie,
      heladera.medidas ? `${heladera.medidas.ancho}×${heladera.medidas.alto}×${heladera.medidas.profundo} cm` : '—',
    ]],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  y = doc.lastAutoTable?.finalY ?? y + 20

  if (fotoHeladera) {
    doc.addImage(fotoHeladera, 'PNG', 14, y + 6, 60, 60)
  }

  // ── Guardar ─────────────────────────────────────────────────────────────────
  doc.save(`pedido-reparacion-${ticket.numero}-${toDateStr(ticket.fechaPedido)}.pdf`)
}

// Listado genérico imprimible (título + tabla) — usado por el dashboard de
// informes de heladeras para cualquiera de sus tarjetas.
export async function generateListadoPdf(titulo: string, head: string[], rows: (string | number)[][], subtitulo?: string) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')

  if (logo) doc.addImage(logo, 'PNG', 14, 8, 40, 13)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text(titulo, pageW - 14, 14, { align: 'right' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  const fechaHora = new Date().toLocaleString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  doc.text(subtitulo ?? fechaHora, pageW - 14, 20, { align: 'right' })
  doc.setTextColor(0)
  doc.setDrawColor(45, 106, 79)
  doc.setLineWidth(0.6)
  doc.line(14, 26, pageW - 14, 26)

  autoTable(doc, {
    startY: 32,
    head: [head],
    body: rows,
    styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [240, 248, 244] },
    margin: { left: 14, right: 14 },
  })

  const slug = titulo.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
  doc.save(`${slug}-${toDateStr(new Date())}.pdf`)
}
