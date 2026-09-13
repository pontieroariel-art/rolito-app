import { fetchImageAsBase64 } from './pdf'
import { ROLITO_INFO } from './constants'
import { NOMBRE_EMPRESA } from './tangoEmpresas'
import { type BloqueComposicion, formatoRemito, totalPendiente } from './comprobantesTango'
import { sumaCentavos } from './money'
import { finTabla, salidaPdf, encabezadoA4 } from './pdfBase'

// Composición de saldos (estado de cuenta) que el supervisor comparte con el
// cliente desde la calle: una tabla por empresa y código de Tango con las
// facturas (pendientes, o todas las de 12 meses), el remito de cada una, los
// remitos pendientes de facturar, el subtotal y el total. Es un resumen
// informativo, no un comprobante: lleva el sello de cuándo se tomaron los
// datos de Tango. Los bloques vienen de utils/comprobantesTango.armarComposicion
// (ya filtrados por sucursal si el supervisor eligió una).

export interface DatosComposicionSaldos {
  cliente: {
    razonSocial: string
    cuit?:       string
    /** "Redonhielo FC.280 · Rolito FC.280" — lo arma la ficha con codigosTangoResumen. */
    codigos?:    string
  }
  bloques:        BloqueComposicion[]
  modo:           'pendientes' | 'todas'
  /** Etiqueta de la sucursal elegida ('' = todas). */
  sucursal?:      string
  /** Momento del dato de Tango (actualizadoEn del cache). */
  datosAl:        Date | null
  /** true si Tango no respondió fresco en esta apertura y se usó el cache. */
  esCache:        boolean
  generadoPor:    string
  fecha:          Date
}

const money = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fechaCorta = (iso: string | undefined) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}
const fechaHora = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const ESTADO = { pendiente: '', pagada: 'Pagada', anulada: 'Anulada' } as const

export function nombreArchivoComposicionSaldos(d: Pick<DatosComposicionSaldos, 'cliente' | 'fecha'> & { modo?: 'pendientes' | 'todas' }): string {
  const slug = d.cliente.razonSocial.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40)
  const f = d.fecha
  const ymd = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
  return `${d.modo === 'todas' ? 'cuenta' : 'saldos'}-${slug || 'cliente'}-${ymd}.pdf`
}

export async function generateComposicionSaldosPdf(d: DatosComposicionSaldos, opts: { descargar?: boolean } = {}): Promise<Blob | void> {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')
  const todas = d.modo === 'todas'

  encabezadoA4({ doc, pageW, logo }, todas ? 'Estado de cuenta (12 meses)' : 'Composición de saldos', `Emitido el ${fechaHora(d.fecha)}`, { tamSubtitulo: 9 })

  const filasCliente: string[][] = [['Cliente', d.cliente.razonSocial]]
  if (d.cliente.cuit) filasCliente.push(['CUIT', d.cliente.cuit])
  if (d.sucursal) filasCliente.push(['Sucursal', d.sucursal])
  else if (d.cliente.codigos) filasCliente.push(['Códigos', d.cliente.codigos])
  const sello = d.datosAl
    ? `Datos de Tango al ${fechaHora(d.datosAl)}${d.esCache ? ' (última actualización disponible)' : ' (consulta en vivo)'}`
    : 'Sin datos de Tango para este cliente'
  filasCliente.push(['Datos', sello])
  autoTable(doc, {
    startY: 32,
    theme: 'plain',
    body: filasCliente,
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 } },
    margin: { left: 14, right: 14 },
  })
  let y = finTabla(doc, 60) + 4

  if (d.bloques.length === 0) {
    doc.setFontSize(11)
    doc.text(todas ? 'El cliente no tiene comprobantes en los últimos 12 meses.' : 'El cliente no tiene comprobantes pendientes.', 14, y + 6)
    y += 12
  }
  for (const b of d.bloques) {
    if (y > 250) { doc.addPage(); y = 20 }
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(`${NOMBRE_EMPRESA[b.grupo.empresa]}${b.grupo.codigo ? ` · cliente ${b.grupo.codigo}` : ''}`, 14, y + 5)
    doc.setFont('helvetica', 'normal')
    const atraso = Math.max(0, ...b.filas.map((f) => f.diasAtraso ?? 0))
    if (atraso > 0) {
      doc.setFontSize(9)
      doc.setTextColor(180, 40, 40)
      doc.text(`${atraso} ${atraso === 1 ? 'día' : 'días'} de atraso`, pageW - 14, y + 5, { align: 'right' })
      doc.setTextColor(0)
    }
    const body: (string | { content: string; colSpan: number; styles: Record<string, unknown> })[][] = []
    for (const f of b.filas) {
      body.push([
        `${f.tipo} ${f.numero}`,
        fechaCorta(f.fecha),
        fechaCorta(f.fechaVencimiento),
        f.estado !== 'pendiente' ? ESTADO[f.estado] : f.diasAtraso && f.diasAtraso > 0 ? `${f.diasAtraso} d` : '',
        money(f.importe),
        f.pendiente === null ? '' : money(f.pendiente),
      ])
      if (f.remitos.length) {
        body.push([{ content: `Remito${f.remitos.length > 1 ? 's' : ''}: ${f.remitos.map(formatoRemito).join(', ')}`, colSpan: 6, styles: { fontSize: 7.5, textColor: [110, 110, 110], cellPadding: { top: 0, bottom: 1.5, left: 6, right: 2 } } }])
      }
    }
    if (b.filas.length) {
      autoTable(doc, {
        startY: y + 8,
        head: [['Comprobante', 'Emisión', 'Vencimiento', todas ? 'Estado' : 'Atraso', 'Importe', 'Pendiente']],
        body,
        foot: [['', '', '', '', 'Subtotal pendiente', money(b.subtotalPendiente)]],
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: [45, 106, 79], textColor: 255 },
        footStyles: { fontStyle: 'bold', fillColor: [240, 240, 240], textColor: 0, halign: 'right' },
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
        margin: { left: 14, right: 14 },
      })
      y = finTabla(doc, y) + 4
    } else {
      y += 8
    }
    if (b.remitosSinFacturar.length) {
      autoTable(doc, {
        startY: y + 1,
        head: [['Remitos pendientes de facturar', 'Fecha', 'Bultos']],
        body: b.remitosSinFacturar.map((r) => [formatoRemito(r.numero), fechaCorta(r.fecha), String(r.bultos)]),
        styles: { fontSize: 8.5, cellPadding: 1.8 },
        headStyles: { fillColor: [120, 120, 120], textColor: 255 },
        columnStyles: { 2: { halign: 'right' } },
        margin: { left: 14, right: 14 },
      })
      y = finTabla(doc, y) + 4
    }
    y += 2
  }

  const total = totalPendiente(d.bloques)
  if (y > 250) { doc.addPage(); y = 20 }
  doc.setDrawColor(45, 106, 79)
  doc.setLineWidth(0.4)
  doc.line(14, y, pageW - 14, y)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Total pendiente', 14, y + 7)
  doc.text(money(total), pageW - 14, y + 7, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  y += 14

  doc.setFontSize(8)
  doc.setTextColor(100)
  const leyenda = doc.splitTextToSize(
    `Resumen informativo emitido por ${d.generadoPor} desde la app de ${ROLITO_INFO.razonSocial}. Los pagos y comprobantes posteriores a la fecha de los datos pueden no estar reflejados. No es un comprobante fiscal ni un recibo. Consultas: ${ROLITO_INFO.telefono}.`,
    pageW - 28,
  )
  doc.text(leyenda, 14, y)
  doc.setTextColor(0)

  return salidaPdf(doc, nombreArchivoComposicionSaldos(d), opts.descargar)
}

/** Total pendiente de una lista de bloques, en pesos (para textos de pantalla). */
export const totalDeBloques = (bloques: BloqueComposicion[]): number => sumaCentavos(bloques.map((b) => b.subtotalPendiente)) / 100
