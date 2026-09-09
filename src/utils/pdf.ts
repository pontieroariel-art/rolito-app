import { EnvasesCarga, Liquidacion, Order, OrderProduct } from '../types'
import { toDateStr } from './helpers'
import { describirEnvases, describirRacks, envasesDeRemito, type EnvasesNormalizados } from './envases'
import { ROLITO_INFO, COMODATO_COMODANTE, PLANTA_INFO } from './constants'

// El logo fuente (/logo-rolito.png) es un PNG de 8334x2836px — insertado tal
// cual con doc.addImage(), jsPDF lo reincrusta a resolución completa (el PDF
// final termina pesando decenas de MB para un logo que se imprime a 48x16mm).
// Se reescala acá a un ancho de impresión razonable antes de convertir a
// base64, así el PDF queda liviano sin perder nitidez en el encabezado.
export async function fetchImageAsBase64(url: string, maxWidth = 600): Promise<string | null> {
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
}, opts: { descargar?: boolean } = {}): Promise<Blob | void> {
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

  if (opts.descargar === false) return doc.output('blob')
  doc.save(nombreArchivoComodato(numero, fecha))
}

export const nombreArchivoComodato = (numero: number, fecha: Date) => `comodato-${numero}-${toDateStr(fecha)}.pdf`

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
  // Composición de envases (desde 2026-09-07); ausente al reimprimir remitos viejos.
  envases?:     EnvasesCarga
  creadoPor:    { nombre: string }
  fecha:        Date
}, opts: { descargar?: boolean } = {}): Promise<Blob | void> {
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

  if (remito.envases) {
    // Envases retornables (2026-09-07): composición que dictó muelle y lo que
    // tiene que volver. Puntales y aros van implícitos, 4 y 1 por pallet.
    const e = envasesDeRemito({ palletsCarga: remito.palletsCarga, envases: remito.envases })
    const filas: string[][] = [
      ['Pallets de madera (completos)', String(e.tarimasMadera), 'tarima + 4 puntales + 1 aro'],
      ['Pallets de metal', String(e.palletsMetal), 'pallet de metal + 4 puntales + 1 aro'],
      ['Puntales', String(e.puntales), ''],
      ['Aros', String(e.aros), ''],
      ['Racks de agua', String(e.racks.length), e.racks.length ? describirRacks(e.racks) : '—'],
    ]
    autoTable(doc, {
      startY: y,
      head: [['Envases retornables', 'Cant.', '']],
      body: filas,
      styles: { fontSize: 8.5, cellPadding: 1.8 },
      headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      columnStyles: { 0: { cellWidth: 58 }, 1: { halign: 'right', cellWidth: 16 }, 2: { textColor: 100 } },
      margin: { left: 14, right: 60 },
    })
    // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
    y = (doc.lastAutoTable?.finalY ?? y + 30) + 5
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(60)
    const leyenda = `Deben regresar: ${e.tarimasMadera} tarima${e.tarimasMadera === 1 ? '' : 's'} de madera, ${e.palletsMetal} pallet${e.palletsMetal === 1 ? '' : 's'} de metal, ${e.puntales} puntales, ${e.aros} aro${e.aros === 1 ? '' : 's'}` +
      (e.racks.length ? ` y los racks ${describirRacks(e.racks)}.` : '.') + ' Muelle los cuenta al descargar.'
    const lineas: string[] = doc.splitTextToSize(leyenda, pageW - 28)
    doc.text(lineas, 14, y)
    doc.setFont('helvetica', 'normal')
    y += lineas.length * 4 + 18
  } else {
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
  }

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

  if (opts.descargar === false) return doc.output('blob')
  doc.save(`${remito.codigo}.pdf`)
}

// ── Liquidación de repartidores (módulo expedición) ──────────────────────────
// Espejo de la hoja del sistema viejo: detalle por producto (carga / venta /
// promoción / cambios / devolución teórica / descarga / diferencia), cuadre de
// envases, cambios vs rotas, importes y rendición de efectivo.
// Detalle del reparto para el PDF (2026-09-06): los mismos bloques de la
// pantalla (contado / cta cte / promo / cobranzas / cambios), con hora,
// cliente, artículos, comprobante y número de Tango, más el recorrido.
export interface DetalleLiquidacionPdf {
  reparto:   import('./liquidacion').RepartoClasificado
  remitos:   Array<{ codigo: string; camionLabel: string; fecha: Date; salida?: Date | null; entregado?: Date | null; items: Array<{ nombre: string; cantidad: number }>; envases: EnvasesNormalizados }>
  descargas: Array<{ fecha: Date; registradoPor: string; items: Array<{ nombre: string; cantidad: number }>; rotas: number; envases: EnvasesNormalizados }>
}

export async function generateLiquidacion(liq: Liquidacion, detalle?: DetalleLiquidacionPdf, opts: { descargar?: boolean } = {}): Promise<Blob | void> {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const { describirComprobante, estadoTangoVenta } = await import('./comprobanteDeVenta')
  const { nombreDelCambio } = await import('./cambios')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')
  const money = (n: number) => `${n.toLocaleString('es-AR')}`
  const hora = (d: Date | null | undefined) => d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—'

  if (logo) doc.addImage(logo, 'PNG', 14, 8, 40, 13)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text('Liquidación de repartidores', pageW - 14, 14, { align: 'right' })
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  doc.text(`${liq.codigo ? `${liq.codigo}   ·   ` : ''}${liq.depositoTango ? `${liq.depositoTango} · ` : ''}${liq.choferNombre}   ·   ${liq.fecha}`, pageW - 14, 20, { align: 'right' })
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

  const signo = (n: number) => (n === 0 ? '0' : n > 0 ? `+${n}` : String(n))
  if (liq.envases) {
    // Cuadre de envases por tipo (desde 2026-09-07) + cambios vs rotas.
    const e = liq.envases
    autoTable(doc, {
      startY: y,
      head: [['Envases', 'Salieron', 'Volvieron', 'Dif.']],
      body: [
        ['Pallets de madera', String(e.salieron.tarimasMadera), String(e.volvieron.tarimasMadera), signo(e.diferencia.tarimasMadera)],
        ['Pallets de metal', String(e.salieron.palletsMetal), String(e.volvieron.palletsMetal), signo(e.diferencia.palletsMetal)],
        ['Puntales', String(e.salieron.puntales), String(e.volvieron.puntales), signo(e.diferencia.puntales)],
        ['Aros', String(e.salieron.aros), String(e.volvieron.aros), signo(e.diferencia.aros)],
        ['Racks de agua', String(e.salieron.racks.length), String(e.volvieron.racks.length), signo(e.volvieron.racks.length - e.salieron.racks.length)],
        [{ content: e.racksFaltantes.length ? `Racks que no volvieron: ${describirRacks(e.racksFaltantes)}` : (e.salieron.racks.length ? `Todos los racks volvieron (${describirRacks(e.salieron.racks)})` : 'Sin racks'), colSpan: 4, styles: { fontStyle: e.racksFaltantes.length ? 'bold' : 'normal' } }],
        ['Cambios registrados por el chofer', '', '', String(liq.cambios.registrados)],
        ['Bolsas rotas recibidas en muelle', '', '', String(liq.cambios.rotasRecibidas)],
      ],
      // Misma columna izquierda que la tabla vieja (74 mm): a la derecha va
      // "Importes y rendición".
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      columnStyles: { 0: { cellWidth: 32 }, 1: { halign: 'right', cellWidth: 14 }, 2: { halign: 'right', cellWidth: 17 }, 3: { halign: 'right', cellWidth: 11, fontStyle: 'bold' } },
      margin: { left: 14, right: 108 },
    })
  } else {
    const p = liq.pallets ?? { salidos: 0, completos: 0, parciales: 0, vacios: 0, diferencia: 0 }
    autoTable(doc, {
      startY: y,
      head: [['Envases (pallets)', ''], ],
      body: [
        ['Salieron', String(p.salidos)],
        ['Volvieron completos (con hielo)', String(p.completos)],
        ['Volvieron parciales', String(p.parciales)],
        ['Volvieron vacíos (base + 4 puntales)', String(p.vacios)],
        ['Diferencia', p.diferencia === 0 ? '0' : String(p.diferencia)],
        ['Cambios registrados por el chofer', String(liq.cambios.registrados)],
        ['Bolsas rotas recibidas en muelle', String(liq.cambios.rotasRecibidas)],
      ],
      styles: { fontSize: 8.5, cellPadding: 2 },
      headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 1: { halign: 'right', cellWidth: 30 } },
      margin: { left: 14, right: 108 },
    })
  }
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
      ...(liq.cobranzasCalle && liq.cobranzasCalle.cantidad > 0 ? [
        [`Cobranzas en efectivo (${liq.cobranzasCalle.cantidad})`, money(liq.cobranzasCalle.efectivo)],
        ['Cobranzas por transferencia', money(liq.cobranzasCalle.transferencia)],
        ...(liq.cobranzasCalle.cheques ? [[`Cheques (${liq.cobranzasCalle.cheques.cantidad})`, money(liq.cobranzasCalle.cheques.total)]] : []),
        ...(liq.cobranzasCalle.retenciones ? [[`Retenciones (${liq.cobranzasCalle.retenciones.cantidad})`, money(liq.cobranzasCalle.retenciones.total)]] : []),
      ] : []),
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
  y = Math.max(yEnvases, doc.lastAutoTable?.finalY ?? y + 40) + 6

  if (liq.diferencia) {
    const { MOTIVOS_DIFERENCIA_LIQUIDACION } = await import('../types')
    doc.setFontSize(9)
    doc.setTextColor(180, 0, 0)
    doc.text(`Diferencia de efectivo ${money(liq.diferenciaEfectivo)} · ${MOTIVOS_DIFERENCIA_LIQUIDACION[liq.diferencia.motivo]}${liq.diferencia.nota ? ` · ${liq.diferencia.nota}` : ''}`, 14, y, { maxWidth: pageW - 28 })
    doc.setTextColor(0)
    y += 8
  }

  // ── Valores en papel tildados por caja al recibirlos (2026-09-09) ──
  const valores = [...(liq.cheques ?? []), ...(liq.retenciones ?? [])]
  if (valores.length) {
    const { RETENCION_LABELS } = await import('../components/supervisor/RetencionForm')
    autoTable(doc, {
      startY: y,
      head: [[{ content: `Valores en papel — ${valores.length} recibidos por caja${liq.valoresFaltantes?.cantidad ? ` · ${liq.valoresFaltantes.cantidad} NO entregados (${money(liq.valoresFaltantes.total)})` : ''}`, colSpan: 5, styles: { fillColor: [45, 106, 79] as [number, number, number], textColor: 255, fontStyle: 'bold' as const, fontSize: 7.5, halign: 'left' as const } }], ['Valor', 'Cliente', 'Recibo', 'Importe', 'Recibido']],
      body: [
        ...(liq.cheques ?? []).map((ch) => [`Cheque${ch.esEcheq ? ' electrónico' : ''} ${ch.numero} · ${ch.bancoNombre} · acredita ${ch.fechaAcreditacion || '—'}`, ch.clienteNombre, ch.numeroRecibo ?? '', money(ch.importe), ch.recibido === false ? `NO · ${ch.motivoNoEntregado ?? ''}` : 'Sí']),
        ...(liq.retenciones ?? []).map((re) => [`Retención ${RETENCION_LABELS[re.tipo] ?? re.tipo} · cert. ${re.nroCertificado}`, re.clienteNombre, re.numeroRecibo ?? '', money(re.importe), re.recibido === false ? `NO · ${re.motivoNoEntregado ?? ''}` : 'Sí']),
      ],
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: [45, 106, 79], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 3: { halign: 'right', cellWidth: 24 }, 4: { cellWidth: 40 } },
      margin: { left: 14, right: 14 },
    })
    // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 6
  }

  // ── Detalle del reparto (los mismos bloques de la pantalla) ──
  const head = (t: string) => ({ fillColor: [45, 106, 79] as [number, number, number], textColor: 255, fontStyle: 'bold' as const, fontSize: 7.5, halign: 'left' as const, cellPadding: 2, text: t })
  const tabla = (titulo: string, cabecera: string[], filas: (string | number)[][], cols: Record<number, object> = {}) => {
    if (filas.length === 0) return
    autoTable(doc, {
      startY: y,
      head: [[{ content: titulo, colSpan: cabecera.length, styles: head(titulo) }], cabecera],
      body: filas,
      styles: { fontSize: 7.5, cellPadding: 1.6, overflow: 'linebreak' },
      headStyles: { fillColor: [235, 232, 222], textColor: 40, fontStyle: 'bold', fontSize: 7 },
      columnStyles: cols,
      margin: { left: 14, right: 14 },
    })
    // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 5
  }
  if (detalle) {
    const r = detalle.reparto
    const filaVenta = (v: import('../types').VentaCamion) => {
      const c = describirComprobante(v)
      const t = estadoTangoVenta(v)
      const arts = [
        ...v.items.map((i) => `${i.cantidad} × ${i.nombre}`),
        ...(v.cambios ?? []).map((i) => `${i.cantidad} × ${nombreDelCambio(i.nombre)} (cambio)`),
      ].join('\n')
      return [hora(v.fecha.toDate()), `${v.clienteNombre}${v.clienteCodigoTango ? ` · ${v.clienteCodigoTango}` : ''}`, arts, `${c.etiqueta} ${c.numero}${c.detalle ? ` · ${c.detalle}` : ''}`, t.estado === 'confirmado' ? t.texto.replace('Tango ✓ ', '') : t.estado === 'error' ? 'ERROR' : 'pendiente', money(v.total)]
    }
    const cabV = ['Hora', 'Cliente', 'Artículos', 'Comprobante', 'Tango', 'Importe']
    const colsV = { 0: { cellWidth: 12 }, 2: { cellWidth: 48 }, 5: { halign: 'right', cellWidth: 22 } }
    tabla(`Recorrido`, ['Salida', 'Carga', 'Vuelta', 'Descarga'], detalle.remitos.length + detalle.descargas.length === 0 ? [] : [[
      detalle.remitos.map((rc) => `${rc.codigo} · ${rc.camionLabel}\nmuelle ${hora(rc.entregado)} · portón ${hora(rc.salida)}`).join('\n') || '—',
      detalle.remitos.map((rc) => rc.items.map((i) => `${i.cantidad} × ${i.nombre}`).concat(describirEnvases(rc.envases) ? [`envases: ${describirEnvases(rc.envases)}`] : []).join('\n')).join('\n') || '—',
      detalle.descargas.map((d) => `${hora(d.fecha)} (${d.registradoPor})`).join('\n') || 'sin descarga',
      detalle.descargas.map((d) => d.items.map((i) => `${i.cantidad} × ${i.nombre}`).concat(d.rotas ? [`${d.rotas} rotas`] : [], describirEnvases(d.envases) ? [`envases: ${describirEnvases(d.envases)}`] : []).join('\n')).join('\n') || '—',
    ]])
    tabla(`Ventas contado · Redonhielo — ${money(r.contado.total)} (efectivo ${money(r.contado.efectivo.total)} · transferencia ${money(r.contado.transferencia.total)})`, cabV,
      [...r.contado.efectivo.ventas.map((v) => filaVenta(v)), ...r.contado.transferencia.ventas.map((v) => filaVenta(v))], colsV)
    tabla(`Ventas cuenta corriente · Redonhielo — ${money(r.cuentaCorriente.total)} (no se rinde)`, cabV, r.cuentaCorriente.ventas.map((v) => filaVenta(v)), colsV)
    tabla(`Promo · Rolito — ${money(r.promo.total)} (contado ${money(r.promo.contado.total)} · cta. cte. ${money(r.promo.cuentaCorriente.total)})`, cabV,
      [...r.promo.contado.ventas.map((v) => filaVenta(v)), ...r.promo.cuentaCorriente.ventas.map((v) => filaVenta(v))], colsV)
    const filaCob = (c: import('../types').Cobranza) => {
      const medios = c.medios
        ? [c.medios.efectivo > 0 ? `efectivo ${money(c.medios.efectivo)}` : '', c.medios.transferencia > 0 ? `transferencia ${money(c.medios.transferencia)}` : '', ...c.medios.cheques.map((ch) => `cheque ${ch.bancoNombre} ${ch.numero} ${money(ch.importe)}`), ...c.medios.retenciones.map((rt) => `retención ${money(rt.importe)}`)].filter(Boolean).join('\n')
        : (c.formaPago === 'contado_transferencia' ? 'transferencia' : 'efectivo')
      return [hora(c.fecha.toDate()), `${c.clienteNombre}${c.codigoTango ? ` · ${c.codigoTango}` : ''}`, medios, (c.imputaciones ?? []).map((i) => `${i.comprobanteTipo} ${i.comprobanteNumero}`).join('\n'), `${c.numeroRecibo ?? 'sin número'}${c.tango?.reciboNumero ? ` · ${c.tango.reciboNumero}` : ''}`, money(c.importe)]
    }
    const cabC = ['Hora', 'Cliente', 'Medios', 'Imputa', 'Recibo · Tango', 'Importe']
    tabla(`Cobranzas — ${money(r.cobranzas.total)} (efectivo ${money(r.cobranzas.efectivo)} se rinde · cheques ${money(r.cobranzas.cheques.total)})`, cabC,
      [...r.cobranzas.redonhielo.map((c) => [...filaCob(c)]), ...r.cobranzas.rolito.map((c) => { const f = filaCob(c); f[1] = `${f[1]} · Rolito`; return f })], { 0: { cellWidth: 12 }, 5: { halign: 'right', cellWidth: 22 } })
    tabla(`Cambios — ${r.cambios.unidades} bolsas (rotas recibidas en muelle: ${r.cambios.rotasRecibidas})`, ['Hora', 'Cliente', 'Bolsas repuestas'],
      r.cambios.lista.map((c) => [hora(c.fecha.toDate()), c.clienteNombre, c.items.map((i) => `${i.cantidad} × ${nombreDelCambio(i.nombre)}`).join('\n')]), { 0: { cellWidth: 12 } })
    tabla('Resumen por cliente', ['Cliente', 'Código', 'Contado', 'Cta. cte.', 'Promo', 'Cobrado', 'Cambios'],
      r.clientes.map((c) => [c.nombre, c.codigoTango, money(c.contado), money(c.cuentaCorriente), money(c.promo), money(c.cobrado), c.cambios]),
      { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } })
  }

  // ── Firmas ──
  const pageH = doc.internal.pageSize.getHeight()
  if (y + 40 > pageH) { doc.addPage(); y = 20 }
  y += 18
  doc.setDrawColor(150)
  doc.setLineWidth(0.2)
  if (liq.firmaRepartidor) {
    try { doc.addImage(liq.firmaRepartidor, 'PNG', 14, y - 18, 50, 16) } catch { /* firma ilegible: queda la línea */ }
  }
  // Firma de quien recibe (el cajero), desde 2026-09-09: constancia para el repartidor.
  if (liq.firmaRecibe) {
    try { doc.addImage(liq.firmaRecibe, 'PNG', pageW - 88, y - 18, 50, 16) } catch { /* idem */ }
  }
  doc.line(14, y, 88, y)
  doc.line(pageW - 88, y, pageW - 14, y)
  doc.setFontSize(8)
  doc.setTextColor(100)
  doc.text(`Firma del repartidor${liq.firmanteRepartidor ? `: ${liq.firmanteRepartidor}` : ''}`, 14, y + 4)
  doc.text(`Recibió (caja): ${liq.firmanteRecibe ?? liq.cerradaPor.nombre}`, pageW - 88, y + 4)

  if (opts.descargar === false) return doc.output('blob')
  doc.save(nombreArchivoLiquidacion(liq))
}

export const nombreArchivoLiquidacion = (liq: Pick<Liquidacion, 'fecha' | 'choferNombre' | 'codigo'>) =>
  `liquidacion-${liq.fecha}-${liq.choferNombre.toLowerCase().replace(/\s+/g, '-')}${liq.codigo ? `-${liq.codigo}` : ''}.pdf`

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

// ── Recibo de cobranza de supervisor (multi-medio, con imputaciones) ─────────
// Numerado (RS-000123), con tabla de facturas imputadas y tabla de valores
// recibidos (efectivo / transferencia / cheques con banco, fechas y días /
// retenciones con certificado). Ver plan de cobranzas de supervisores.
export async function generateReciboCobranzaSupervisor(cobranza: {
  numeroRecibo?: string   // ausente mientras la numeración no esté inicializada
  clienteNombre: string
  empresa:       'redonhielo' | 'rolito'
  importe:       number
  imputaciones:  Array<{ comprobanteTipo: string; comprobanteNumero: string; saldoAlMomento: number; importeImputado: number }>
  medios: {
    efectivo:      number
    transferencia: number
    cheques:       Array<{ numero: string; bancoNombre: string; fechaEmision: string; fechaAcreditacion: string; dias: number; importe: number }>
    retenciones:   Array<{ tipo: string; nroCertificado: string; importe: number }>
    aCuentaAplicado?: Array<{ reciboNumero: string; importe: number }>
  }
  /** Parte de los valores que queda a cuenta (saldo a favor del cliente). */
  aCuenta?:      number
  registradoPor: string
  fecha:         Date
}, opts: { descargar?: boolean } = {}): Promise<Blob | void> {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')
  const money = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const RETENCION_LABELS: Record<string, string> = {
    ganancias: 'Ret. Ganancias', iva: 'Ret. IVA', iibb_caba: 'Ret. IIBB CABA',
    iibb_pba: 'Ret. IIBB Prov. Bs. As.', suss: 'Ret. SUSS',
  }

  const fechaStr = cobranza.fecha.toLocaleString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  if (logo) doc.addImage(logo, 'PNG', 14, 8, 40, 13)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text(cobranza.numeroRecibo ? `Recibo ${cobranza.numeroRecibo}` : 'Recibo de Cobranza', pageW - 14, 14, { align: 'right' })
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
      ['Empresa', cobranza.empresa === 'rolito' ? 'Rolito' : 'Redonhielo S.A.'],
    ],
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 36 } },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  let y = (doc.lastAutoTable?.finalY ?? 60) + 6

  // Facturas imputadas (+ lo que queda a cuenta del cliente, si sobraron valores)
  const aCuenta = cobranza.aCuenta ?? 0
  autoTable(doc, {
    startY: y,
    head: [['Imputado a', 'Saldo al cobro', 'Importe imputado']],
    body: [
      ...cobranza.imputaciones.map((i) => [
        `${i.comprobanteTipo} ${i.comprobanteNumero}`,
        money(i.saldoAlMomento),
        money(i.importeImputado),
      ]),
      ...(aCuenta > 0 ? [['A CUENTA — queda a favor del cliente para imputar a próximas facturas', '', money(aCuenta)]] : []),
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [45, 106, 79], textColor: 255 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  y = (doc.lastAutoTable?.finalY ?? y) + 6

  // Valores recibidos (multi-medio)
  const filasMedios: string[][] = []
  if (cobranza.medios.efectivo > 0) filasMedios.push(['Efectivo', '', money(cobranza.medios.efectivo)])
  if (cobranza.medios.transferencia > 0) filasMedios.push(['Transferencia', '', money(cobranza.medios.transferencia)])
  for (const ch of cobranza.medios.cheques) {
    filasMedios.push([
      `Cheque Nº ${ch.numero} — ${ch.bancoNombre}`,
      `Emisión ${ch.fechaEmision} · Acreditación ${ch.fechaAcreditacion} (${ch.dias} ${ch.dias === 1 ? 'día' : 'días'})`,
      money(ch.importe),
    ])
  }
  for (const r of cobranza.medios.retenciones) {
    filasMedios.push([
      RETENCION_LABELS[r.tipo] ?? r.tipo,
      `Certificado Nº ${r.nroCertificado}`,
      money(r.importe),
    ])
  }
  for (const a of cobranza.medios.aCuentaAplicado ?? []) {
    filasMedios.push(['Saldo a favor aplicado', `Recibo a cuenta ${a.reciboNumero}`, money(a.importe)])
  }
  autoTable(doc, {
    startY: y,
    head: [['Valores recibidos', 'Detalle', 'Importe']],
    body: filasMedios,
    foot: [['', 'Total', money(cobranza.importe)]],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [45, 106, 79], textColor: 255 },
    footStyles: { fontStyle: 'bold', fillColor: [240, 240, 240], textColor: 0, halign: 'right' },
    columnStyles: { 2: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  y = (doc.lastAutoTable?.finalY ?? y) + 26

  doc.setDrawColor(150)
  doc.setLineWidth(0.2)
  doc.line(pageW - 88, y, pageW - 14, y)
  doc.setFontSize(8)
  doc.setTextColor(100)
  doc.text(`Firma y aclaración — Cobró: ${cobranza.registradoPor}`, pageW - 88, y + 4)

  const archivo = nombreArchivoReciboSupervisor(cobranza)
  if (opts.descargar === false) return doc.output('blob')
  doc.save(archivo)
}

/** Nombre del PDF del recibo de supervisor: 'recibo-RS-000123.pdf' (o por fecha si no tiene número). */
export function nombreArchivoReciboSupervisor(c: { numeroRecibo?: string; fecha: Date }): string {
  return `recibo-${c.numeroRecibo ?? `cobranza-${c.fecha.getTime()}`}.pdf`
}
