import type { ComprobanteSaldoTango } from '@/types'
import { fetchImageAsBase64 } from './pdf'
import { ROLITO_INFO } from './constants'
import { NOMBRE_EMPRESA } from './tangoEmpresas'
import { agruparPorEmpresaYCodigo, atrasoMaximo } from './composicionSaldos'
import { sumaCentavos } from './money'

// Composición de saldos (estado de cuenta) que el supervisor comparte con el
// cliente desde la calle: una tabla por empresa y código de Tango con las
// facturas pendientes, el subtotal y el total. Es un resumen informativo, no
// un comprobante: lleva el sello de cuándo se tomaron los datos de Tango.

export interface DatosComposicionSaldos {
  cliente: {
    razonSocial: string
    cuit?:       string
    /** "Redonhielo FC.280 · Rolito FC.280" — lo arma la ficha con codigosTangoResumen. */
    codigos?:    string
  }
  comprobantes:   ComprobanteSaldoTango[]
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

export function nombreArchivoComposicionSaldos(d: Pick<DatosComposicionSaldos, 'cliente' | 'fecha'>): string {
  const slug = d.cliente.razonSocial.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40)
  const f = d.fecha
  const ymd = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
  return `saldos-${slug || 'cliente'}-${ymd}.pdf`
}

export async function generateComposicionSaldosPdf(d: DatosComposicionSaldos, opts: { descargar?: boolean } = {}): Promise<Blob | void> {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')

  if (logo) doc.addImage(logo, 'PNG', 14, 8, 40, 13)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text('Composición de saldos', pageW - 14, 14, { align: 'right' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  doc.text(`Emitido el ${fechaHora(d.fecha)}`, pageW - 14, 20, { align: 'right' })
  doc.setTextColor(0)
  doc.setDrawColor(45, 106, 79)
  doc.setLineWidth(0.6)
  doc.line(14, 26, pageW - 14, 26)

  const filasCliente: string[][] = [['Cliente', d.cliente.razonSocial]]
  if (d.cliente.cuit) filasCliente.push(['CUIT', d.cliente.cuit])
  if (d.cliente.codigos) filasCliente.push(['Códigos', d.cliente.codigos])
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
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  let y = (doc.lastAutoTable?.finalY ?? 60) + 4

  const bloques = agruparPorEmpresaYCodigo(d.comprobantes)
  if (bloques.length === 0) {
    doc.setFontSize(11)
    doc.text('El cliente no tiene comprobantes pendientes.', 14, y + 6)
    y += 12
  }
  for (const b of bloques) {
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(`${NOMBRE_EMPRESA[b.grupo.empresa]}${b.grupo.codigo ? ` · cliente ${b.grupo.codigo}` : ''}`, 14, y + 5)
    doc.setFont('helvetica', 'normal')
    const atraso = atrasoMaximo(b.comprobantes)
    if (atraso > 0) {
      doc.setFontSize(9)
      doc.setTextColor(180, 40, 40)
      doc.text(`${atraso} ${atraso === 1 ? 'día' : 'días'} de atraso`, pageW - 14, y + 5, { align: 'right' })
      doc.setTextColor(0)
    }
    autoTable(doc, {
      startY: y + 8,
      head: [['Comprobante', 'Emisión', 'Vencimiento', 'Atraso', 'Importe', 'Pendiente']],
      body: b.comprobantes.map((c) => [
        `${c.tipo} ${c.numero}`,
        fechaCorta(c.fechaEmision),
        fechaCorta(c.fechaVencimiento),
        c.diasAtraso && c.diasAtraso > 0 ? `${c.diasAtraso} d` : '',
        money(c.importeOriginal),
        money(c.saldoPendiente),
      ]),
      foot: [['', '', '', '', 'Subtotal', money(b.subtotal)]],
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [45, 106, 79], textColor: 255 },
      footStyles: { fontStyle: 'bold', fillColor: [240, 240, 240], textColor: 0, halign: 'right' },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    })
    // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 6
  }

  const total = sumaCentavos(d.comprobantes.map((c) => c.saldoPendiente)) / 100
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

  if (opts.descargar === false) return doc.output('blob')
  doc.save(nombreArchivoComposicionSaldos(d))
}
