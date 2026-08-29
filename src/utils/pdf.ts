import { Liquidacion, Order, OrderProduct } from '../types'
import { toDateStr } from './helpers'
import { ROLITO_INFO, COMODATO_COMODANTE, PLANTA_INFO } from './constants'

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

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

// Texto real del "CONTRATO DE COMODATO DE HELADERA" de Redonhielo (cláusulas
// PRIMERA a OCTAVA transcriptas tal cual del contrato en papel) — reemplaza
// el contrato genérico de 4 párrafos que tenía generateRemitoComodato. Se
// usa tanto para la firma inicial (asignación) como para cada renovación
// anual — mismo texto, cambia la fecha y el número de contrato.
export async function generateContratoComodato(params: {
  numero:       number
  fecha:        Date
  heladera:     { modelo: string; numeroSerie: string }
  cliente:      { razonSocial: string; cuit: string; direccion: string }
  firmante:     { nombre: string; cargo: string }
  firmaDataUrl: string
}) {
  const { numero, fecha, heladera, cliente, firmante, firmaDataUrl } = params
  const { default: jsPDF } = await import('jspdf')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginL = 14, marginR = 14, maxWidth = pageW - marginL - marginR
  const logo  = await fetchImageAsBase64('/logo-rolito.png')

  const fechaTexto = `${fecha.getDate()} días del mes de ${MESES[fecha.getMonth()]} de ${fecha.getFullYear()}`

  let y = 12
  const nuevaPagina = () => {
    doc.addPage()
    y = 14
  }
  const escribirParrafo = (texto: string, opts: { bold?: boolean; size?: number; gap?: number } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size ?? 9)
    doc.setTextColor(20)
    const lines = doc.splitTextToSize(texto, maxWidth)
    const lineH = (opts.size ?? 9) * 0.42
    if (y + lines.length * lineH > pageH - 20) nuevaPagina()
    doc.text(lines, marginL, y)
    y += lines.length * lineH + (opts.gap ?? 3)
  }

  if (logo) doc.addImage(logo, 'PNG', marginL, y, 32, 11)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(20)
  doc.text(`Nº ${numero}`, pageW - marginR, y + 5, { align: 'right' })
  y += 18

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('CONTRATO DE COMODATO DE HELADERA', pageW / 2, y, { align: 'center' })
  y += 9

  escribirParrafo(
    `En Merlo, provincia de Buenos Aires, a los ${fechaTexto}, entre ${COMODATO_COMODANTE.razonSocial}, ` +
    `representada por el ${COMODATO_COMODANTE.cargo}, ${COMODATO_COMODANTE.representante}, con domicilio real en ` +
    `${COMODATO_COMODANTE.domicilio}, en adelante 'la comodante', por una parte; y por la otra, ${cliente.razonSocial} ` +
    `representada por ${firmante.nombre} (${firmante.cargo}), con documento Nº ${cliente.cuit}, domiciliada en ` +
    `${cliente.direccion || '—'}, en adelante 'la comodataria', se conviene en celebrar el presente contrato de ` +
    `comodato de heladera, conforme a las siguientes cláusulas:`,
    { gap: 4 },
  )

  escribirParrafo(
    `PRIMERA: ${COMODATO_COMODANTE.razonSocial} entrega a la comodataria y ésta recibe en préstamo de uso gratuito ` +
    `una heladera comercial para la conservación de hielo MARCA: ROLITO MODELO: ${heladera.modelo} SERIE: ${heladera.numeroSerie}`,
  )
  escribirParrafo(
    `SEGUNDA: La comodataria reconoce expresamente que la heladera objeto del presente contrato, es de propiedad ` +
    `exclusiva de ${COMODATO_COMODANTE.razonSocial}.`,
  )
  escribirParrafo(
    'TERCERA: El presente contrato se efectúa en concepto de préstamo de uso en forma totalmente gratuita.',
  )
  escribirParrafo(
    `CUARTA: Las partes convienen como condición esencial que la comodataria sólo podrá utilizar la heladera para ` +
    `la venta de hielo provista por ${COMODATO_COMODANTE.razonSocial} en forma exclusiva, pudiendo ésta, en caso de ` +
    `incumplimiento de esta obligación resolver el presente comunicándolo fehacientemente a la comodataria. Ésta ` +
    `deberá poner la heladera a disposición de la comodante dentro del plazo de dos días desde que hubiera sido ` +
    `intimada fehacientemente. ${COMODATO_COMODANTE.razonSocial} se reserva el derecho de reclamar los daños y ` +
    `perjuicios por la retención indebida y el incumplimiento de la obligación de venta de hielo provisto ` +
    `exclusivamente por la comodante.`,
  )
  escribirParrafo(
    `QUINTA: ${COMODATO_COMODANTE.razonSocial} se reserva el derecho de resolver el contrato en cualquier tiempo ` +
    `desde el inicio del mismo, sin expresión de causa y sin derecho a indemnización alguna a favor de la ` +
    `comodataria. La resolución deberá comunicarse fehacientemente a la comodataria, debiendo ésta poner la ` +
    `máquina a disposición de la comodante, dentro del plazo de 48 horas desde que hubiera sido notificada.`,
  )
  escribirParrafo(
    `SEXTA: ${COMODATO_COMODANTE.razonSocial} entrega la heladera en perfectas condiciones de funcionamiento, ` +
    `quedando obligada la comodataria a conservarla en el mismo estado en que la recibe. La comodante se ` +
    `encargará exclusivamente de la conservación técnica de la máquina y de reparar o sustituir por su cuenta las ` +
    `partes que sean necesarias para mantener su normal funcionamiento. Los servicios de mantenimiento y ` +
    `reparación serán efectuados por la comodante durante sus horas normales de trabajo. La comodataria abonará ` +
    `las reparaciones que sean consecuencia del mal uso o negligencia en la obligación de conservar la heladera ` +
    `en el mismo estado en que la recibió.`,
  )
  escribirParrafo(
    `SÉPTIMA: La comodataria no podrá, bajo pena de resolverse el presente contrato, ceder el presente ni alquilar ` +
    `la heladera. Deberá notificar la transferencia del fondo de comercio a la comodante, quien podrá decidir la ` +
    `continuidad o resolución del contrato, sin derecho a indemnización alguna. La comodataria no podrá mover la ` +
    `heladera del lugar en que la comodante la instaló, sin la conformidad de ésta; ni introducirle modificaciones ` +
    `o alteraciones. La comodataria deberá permitir el acceso del personal de ${COMODATO_COMODANTE.razonSocial} a ` +
    `los efectos de realizar las operaciones necesarias o inspeccionar el equipo. Indispensablemente, y como ` +
    `condición esencial del presente y de expresa resolución del mismo, la comodataria deberá efectuar la conexión ` +
    `a tierra del equipo. Deberá asimismo dar aviso a ${COMODATO_COMODANTE.razonSocial} del concurso o quiebra que ` +
    `se le hubiere dispuesto. El presente contrato deja sin valor ni efecto algunos a cualquier acto, contrato, ` +
    `acuerdo o estipulación entre las partes por causa de comodato de heladera.`,
  )
  escribirParrafo(
    'OCTAVA: Las partes se someten a la jurisdicción de los Tribunales Ordinarios de Morón, renunciando a ' +
    'cualquier otro fuero o jurisdicción que pudiere corresponderles. Constituyen domicilios en los indicados arriba.',
    { gap: 10 },
  )

  if (y + 32 > pageH - 20) nuevaPagina()
  doc.addImage(firmaDataUrl, 'PNG', marginL, y, 55, 20)
  doc.setDrawColor(150)
  doc.setLineWidth(0.2)
  doc.line(marginL, y + 22, marginL + 80, y + 22)
  doc.setFontSize(8)
  doc.setTextColor(90)
  doc.text('Firma del comodatario', marginL, y + 26)
  doc.text(`Aclaración: ${firmante.nombre}`, marginL, y + 31)
  doc.text(`Doc.: ${cliente.cuit}`, marginL, y + 35)
  doc.text(`Cargo: ${firmante.cargo}`, marginL, y + 39)

  doc.save(`comodato-${numero}-${toDateStr(fecha)}.pdf`)
}

// "Orden de entrega" — segunda hoja del comodato real: ficha técnica del
// equipo (con compresor, que el contrato no menciona), mapa de ubicación de
// la sucursal y conformidad de recepción. Solo se genera al asignar (primera
// entrega) — una renovación no mueve el equipo, no hace falta otra vez.
export async function generateOrdenEntrega(params: {
  numero:       number
  fecha:        Date
  heladera:     { codigoInterno: string; modelo: string; numeroSerie: string; color: string; fabricacion?: Date | null; compresor?: string | null }
  cliente:      { razonSocial: string; codigoCliente: string; cuit: string; direccion: string; lat?: number | null; lng?: number | null }
}) {
  const { numero, fecha, heladera, cliente } = params
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')

  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  if (logo) doc.addImage(logo, 'PNG', 14, 8, 40, 13)
  doc.text('ORDEN DE ENTREGA', pageW - 14, 14, { align: 'right' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  doc.text(`N° ${numero}   ·   ${fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}`, pageW - 14, 20, { align: 'right' })
  doc.setDrawColor(45, 106, 79)
  doc.setLineWidth(0.6)
  doc.line(14, 26, pageW - 14, 26)

  autoTable(doc, {
    startY: 32,
    theme: 'plain',
    body: [
      ['Cliente',  `${cliente.razonSocial} (${cliente.codigoCliente})`],
      ['CUIT',     cliente.cuit],
      ['Domicilio', cliente.direccion || '—'],
    ],
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 28 } },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  let y = doc.lastAutoTable?.finalY ?? 60

  autoTable(doc, {
    startY: y + 6,
    head: [['Código', 'Modelo', 'Color', 'N° de serie', 'Compresor', 'Fabricación']],
    body: [[
      heladera.codigoInterno, heladera.modelo, heladera.color, heladera.numeroSerie,
      heladera.compresor || '—',
      heladera.fabricacion ? heladera.fabricacion.toLocaleDateString('es-AR') : '—',
    ]],
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  y = doc.lastAutoTable?.finalY ?? y + 20

  // Mapa de ubicación — best-effort: si la Static Maps API no está habilitada
  // en la key o el fetch falla por lo que sea, se sigue sin el mapa (no
  // bloquea la generación del resto del documento).
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
  if (apiKey && cliente.lat != null && cliente.lng != null) {
    const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${cliente.lat},${cliente.lng}&zoom=15&size=600x300&markers=color:red%7C${cliente.lat},${cliente.lng}&key=${apiKey}`
    const mapImg = await fetchImageAsBase64(mapUrl, 600)
    if (mapImg) {
      doc.addImage(mapImg, 'PNG', 14, y + 6, pageW - 28, (pageW - 28) / 2)
      y += 6 + (pageW - 28) / 2
    }
  }

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(20)
  doc.text('Observaciones', 14, y + 10)
  doc.setDrawColor(200)
  doc.setLineWidth(0.2)
  for (let i = 0; i < 4; i++) doc.line(14, y + 15 + i * 6, pageW - 14, y + 15 + i * 6)
  y += 15 + 4 * 6

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(60)
  doc.text('Entregó: ______________________________', 14, y + 10)
  doc.text('Firma en conformidad: x', pageW - 14, y + 10, { align: 'right' })
  doc.text('Aclaración: ______________________________', pageW - 14, y + 16, { align: 'right' })

  doc.save(`orden-entrega-${numero}-${toDateStr(fecha)}.pdf`)
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

// ── Remito de carga del camión (módulo expedición) ───────────────────────────
// Comprobante A4 que caja imprime y le entrega a muelle: contra este papel
// muelle carga la mercadería al camión. Espeja el remito manuscrito del
// circuito viejo. Ver src/services/remitoCargaService.ts.
export async function generateRemitoCarga(remito: {
  codigo:       string
  plantaId:     'torcuato' | 'merlo'
  camionLabel:  string
  choferNombre: string
  items:        { nombre: string; cantidad: number; pallets?: number }[]
  palletsCarga: number
  creadoPor:    { nombre: string }
  fecha:        Date
}) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')
  const planta = PLANTA_INFO[remito.plantaId]

  const fechaStr = remito.fecha.toLocaleString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  if (logo) doc.addImage(logo, 'PNG', 14, 8, 40, 13)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text('Remito de Carga', pageW - 14, 14, { align: 'right' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  doc.text(`${remito.codigo}   ·   ${fechaStr}`, pageW - 14, 20, { align: 'right' })
  doc.setTextColor(0)
  doc.setDrawColor(45, 106, 79)
  doc.setLineWidth(0.6)
  doc.line(14, 26, pageW - 14, 26)

  autoTable(doc, {
    startY: 32,
    theme: 'plain',
    body: [
      ['Planta', `${planta.razonSocial} — ${planta.direccion}, ${planta.localidad}`],
      ['Camión', remito.camionLabel],
      ['Chofer', remito.choferNombre],
    ],
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 28 } },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  let y = (doc.lastAutoTable?.finalY ?? 52) + 6

  autoTable(doc, {
    startY: y,
    head: [['Producto', 'Cantidad', 'Pallets']],
    body: remito.items.map((i) => [i.nombre, String(i.cantidad), i.pallets ? String(i.pallets) : '—']),
    foot: remito.palletsCarga > 0
      ? [['Total pallets de carga', '', String(remito.palletsCarga)]]
      : undefined,
    styles: { fontSize: 9.5, cellPadding: 2.5 },
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    footStyles: { fillColor: [240, 248, 244], textColor: 30, fontStyle: 'bold', fontSize: 9 },
    columnStyles: { 1: { halign: 'right', cellWidth: 28 }, 2: { halign: 'right', cellWidth: 24 } },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  y = (doc.lastAutoTable?.finalY ?? y + 30) + 8

  if (remito.palletsCarga > 0) {
    doc.setFontSize(8.5)
    doc.setTextColor(80)
    doc.text(
      `Envases: ${remito.palletsCarga} base(s) de metal · ${remito.palletsCarga * 4} puntales. ` +
      'Deben regresar como pallets completos, parciales o vacíos (base + 4 puntales).',
      14, y,
    )
  }
  y += 22

  // Firmas en blanco: chofer y muelle firman el papel al cargar, como siempre.
  doc.setDrawColor(150)
  doc.setLineWidth(0.2)
  doc.line(14, y, 88, y)
  doc.line(pageW - 88, y, pageW - 14, y)
  doc.setFontSize(8)
  doc.setTextColor(100)
  doc.text('Firma del chofer', 14, y + 4)
  doc.text('Firma de muelle', pageW - 88, y + 4)
  doc.setFontSize(8.5)
  doc.setTextColor(60)
  doc.text(`Emitió: ${remito.creadoPor.nombre}`, 14, y + 14)

  doc.save(`${remito.codigo}.pdf`)
}

// ── Liquidación de repartidores (módulo expedición) ──────────────────────────
// Espejo de la hoja del sistema viejo: detalle por producto (carga / venta /
// promoción / cambios / devolución teórica / descarga / diferencia), cuadre de
// envases, cambios vs rotas, importes y rendición de efectivo.
export async function generateLiquidacion(liq: Liquidacion) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')
  const money = (n: number) => `$${n.toLocaleString('es-AR')}`

  if (logo) doc.addImage(logo, 'PNG', 14, 8, 40, 13)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text('Liquidación de repartidores', pageW - 14, 14, { align: 'right' })
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  doc.text(`${liq.choferNombre}   ·   ${liq.fecha}`, pageW - 14, 20, { align: 'right' })
  doc.setTextColor(0)
  doc.setDrawColor(45, 106, 79)
  doc.setLineWidth(0.6)
  doc.line(14, 26, pageW - 14, 26)

  autoTable(doc, {
    startY: 32,
    head: [['Producto', 'Carga', 'Venta Cdo.', 'Promoción', 'Cambios', 'Dev. teórica', 'Descarga', 'Diferencia']],
    body: liq.productos.map((p) => [
      p.nombre, String(p.carga), String(p.ventaContado), String(p.ventaPromo),
      String(p.cambios), String(p.devolucionTeorica), String(p.descarga),
      p.diferencia === 0 ? '0' : (p.diferencia > 0 ? `+${p.diferencia}` : String(p.diferencia)),
    ]),
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
      4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  let y = (doc.lastAutoTable?.finalY ?? 60) + 6

  autoTable(doc, {
    startY: y,
    head: [['Envases (pallets)', ''], ],
    body: [
      ['Salieron', String(liq.pallets.salidos)],
      ['Volvieron completos (con hielo)', String(liq.pallets.completos)],
      ['Volvieron parciales', String(liq.pallets.parciales)],
      ['Volvieron vacíos (base + 4 puntales)', String(liq.pallets.vacios)],
      ['Diferencia', liq.pallets.diferencia === 0 ? '0' : String(liq.pallets.diferencia)],
      ['Cambios registrados por el chofer', String(liq.cambios.registrados)],
      ['Bolsas rotas recibidas en muelle', String(liq.cambios.rotasRecibidas)],
    ],
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: { 1: { halign: 'right', cellWidth: 30 } },
    margin: { left: 14, right: 108 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  const yEnvases = doc.lastAutoTable?.finalY ?? y + 40

  autoTable(doc, {
    startY: y,
    head: [['Importes y rendición', '']],
    body: [
      ['Contado efectivo', money(liq.importes.contadoEfectivo)],
      ['Contado transferencia', money(liq.importes.contadoTransferencia)],
      ['Cuenta corriente', money(liq.importes.cuentaCorriente)],
      ['Total vendido', money(liq.importes.total)],
      ['Efectivo a rendir', money(liq.efectivoARendir)],
      ['Efectivo recibido', money(liq.efectivoRecibido)],
      ['Diferencia de efectivo', money(liq.diferenciaEfectivo)],
    ],
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: { 1: { halign: 'right', cellWidth: 34 } },
    margin: { left: 108, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  y = Math.max(yEnvases, doc.lastAutoTable?.finalY ?? y + 40) + 26

  doc.setDrawColor(150)
  doc.setLineWidth(0.2)
  doc.line(14, y, 88, y)
  doc.line(pageW - 88, y, pageW - 14, y)
  doc.setFontSize(8)
  doc.setTextColor(100)
  doc.text('Firma del repartidor', 14, y + 4)
  doc.text(`Caja: ${liq.cerradaPor.nombre}`, pageW - 88, y + 4)

  doc.save(`liquidacion-${liq.fecha}-${liq.choferNombre.toLowerCase().replace(/\s+/g, '-')}.pdf`)
}

// ── Comprobante de venta por ventanilla (módulo expedición) ──────────────────
// Papel contra el que muelle entrega la mercadería al tercero que compró en
// el mostrador. Ver src/services/ventaVentanillaService.ts.
export async function generateComprobanteVentanilla(venta: {
  id:            string
  plantaId:      'torcuato' | 'merlo'
  canal:         'contado' | 'promo'
  clienteNombre: string
  clienteCuit?:  string
  items:         { nombre: string; cantidad: number; precioUnitario: number }[]
  total:         number
  formaPago:     string
  cajaNombre:    string
  fecha:         Date
}) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')
  const planta = PLANTA_INFO[venta.plantaId]
  const money  = (n: number) => `$${n.toLocaleString('es-AR')}`
  const FP: Record<string, string> = {
    contado_efectivo: 'Efectivo', contado_transferencia: 'Transferencia', cuenta_corriente: 'Cuenta corriente',
  }

  const fechaStr = venta.fecha.toLocaleString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  if (logo) doc.addImage(logo, 'PNG', 14, 8, 40, 13)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text('Comprobante de Ventanilla', pageW - 14, 14, { align: 'right' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  doc.text(fechaStr, pageW - 14, 20, { align: 'right' })
  doc.setTextColor(0)
  doc.setDrawColor(45, 106, 79)
  doc.setLineWidth(0.6)
  doc.line(14, 26, pageW - 14, 26)

  autoTable(doc, {
    startY: 32,
    theme: 'plain',
    body: [
      ['Planta', `${planta.razonSocial} — ${planta.direccion}, ${planta.localidad}`],
      ['Cliente', venta.clienteCuit ? `${venta.clienteNombre} — CUIT ${venta.clienteCuit}` : venta.clienteNombre],
      ['Canal', venta.canal === 'contado' ? 'Venta Contado (Redonhielo)' : 'Promo (Rolito)'],
      ['Forma de pago', FP[venta.formaPago] ?? venta.formaPago],
    ],
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 32 } },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  let y = (doc.lastAutoTable?.finalY ?? 58) + 6

  autoTable(doc, {
    startY: y,
    head: [['Producto', 'Cantidad', 'Precio', 'Subtotal']],
    body: venta.items.map((i) => [
      i.nombre, String(i.cantidad), money(i.precioUnitario), money(i.precioUnitario * i.cantidad),
    ]),
    foot: [['Total', '', '', money(venta.total)]],
    styles: { fontSize: 9.5, cellPadding: 2.5 },
    headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    footStyles: { fillColor: [240, 248, 244], textColor: 30, fontStyle: 'bold', fontSize: 9.5 },
    columnStyles: {
      1: { halign: 'right', cellWidth: 24 },
      2: { halign: 'right', cellWidth: 30 },
      3: { halign: 'right', cellWidth: 32 },
    },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  y = (doc.lastAutoTable?.finalY ?? y + 30) + 8

  doc.setFontSize(8.5)
  doc.setTextColor(80)
  doc.text('Presentar este comprobante en muelle para retirar la mercadería.', 14, y)
  y += 22

  doc.setDrawColor(150)
  doc.setLineWidth(0.2)
  doc.line(14, y, 88, y)
  doc.setFontSize(8)
  doc.setTextColor(100)
  doc.text('Firma del cliente', 14, y + 4)
  doc.setFontSize(8.5)
  doc.setTextColor(60)
  doc.text(`Caja: ${venta.cajaNombre}`, pageW - 14, y + 4, { align: 'right' })

  doc.save(`ventanilla-${venta.id.slice(0, 8)}.pdf`)
}

// ── Recibo de cobranza en mostrador (módulo expedición) ──────────────────────
export async function generateReciboCobranza(cobranza: {
  id:            string
  plantaId:      'torcuato' | 'merlo'
  clienteNombre: string
  importe:       number
  formaPago:     string
  referencia?:   string
  registradoPor: string
  fecha:         Date
}) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')
  const planta = PLANTA_INFO[cobranza.plantaId]
  const money  = (n: number) => `$${n.toLocaleString('es-AR')}`

  const fechaStr = cobranza.fecha.toLocaleString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  if (logo) doc.addImage(logo, 'PNG', 14, 8, 40, 13)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text('Recibo de Cobranza', pageW - 14, 14, { align: 'right' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  doc.text(fechaStr, pageW - 14, 20, { align: 'right' })
  doc.setTextColor(0)
  doc.setDrawColor(45, 106, 79)
  doc.setLineWidth(0.6)
  doc.line(14, 26, pageW - 14, 26)

  autoTable(doc, {
    startY: 32,
    theme: 'plain',
    body: [
      ['Recibimos de', cobranza.clienteNombre],
      ['La suma de', money(cobranza.importe)],
      ['Forma de pago', cobranza.formaPago === 'contado_efectivo' ? 'Efectivo' : 'Transferencia'],
      ...(cobranza.referencia ? [['En concepto de', cobranza.referencia]] : []),
      ['Planta', `${planta.razonSocial} — ${planta.direccion}, ${planta.localidad}`],
    ],
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 36 } },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  const y = (doc.lastAutoTable?.finalY ?? 70) + 26

  doc.setDrawColor(150)
  doc.setLineWidth(0.2)
  doc.line(pageW - 88, y, pageW - 14, y)
  doc.setFontSize(8)
  doc.setTextColor(100)
  doc.text(`Firma y aclaración — Caja: ${cobranza.registradoPor}`, pageW - 88, y + 4)

  doc.save(`recibo-cobranza-${cobranza.id.slice(0, 8)}.pdf`)
}
