import type { EntregaTesoreria } from '@/types'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS } from '@/types'
import { fetchImageAsBase64 } from './pdf'
import { formatoARS } from './money'

// Acta de entrega de caja a tesorería (2026-09-09): qué se entregó (de qué
// liquidaciones y cierres sale), el efectivo teórico / entregado / contado y
// los valores en papel con lo que tesorería tildó; dos firmas. Mismo estilo
// que rendicionPdf.ts. Sirve tanto recién entregada (firma de tesorería
// pendiente) como confirmada.

export const nombreArchivoActa = (e: Pick<EntregaTesoreria, 'fecha' | 'codigo'>) => `entrega-tesoreria-${e.fecha}-${e.codigo}.pdf`

export async function generateActaEntrega(e: EntregaTesoreria, opts: { descargar?: boolean } = {}): Promise<Blob | void> {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')
  const fechaHora = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const head  = { fillColor: [45, 106, 79] as [number, number, number], textColor: 255, fontStyle: 'bold' as const, fontSize: 7.5 }
  const confirmada = e.estado === 'confirmada'

  if (logo) doc.addImage(logo, 'PNG', 14, 8, 40, 13)
  doc.setFontSize(15); doc.setFont('helvetica', 'bold'); doc.setTextColor(0)
  doc.text('Acta de entrega a tesorería', pageW - 14, 14, { align: 'right' })
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(80)
  doc.text(`${e.codigo}   ·   ${PLANTAS[e.plantaId].label}   ·   ${e.fecha}   ·   ${confirmada ? 'CONFIRMADA por tesorería' : 'Entregada, pendiente de confirmación'}`, pageW - 14, 20, { align: 'right' })
  doc.setTextColor(0); doc.setDrawColor(45, 106, 79); doc.setLineWidth(0.6)
  doc.line(14, 26, pageW - 14, 26)

  autoTable(doc, {
    startY: 32,
    head: [['Origen', 'Código', 'Persona', 'Fecha', 'Efectivo', '']],
    body: [
      ...e.rendiciones.map((r) => ['Cierre de caja', r.codigo, r.sujetoNombre, r.fecha, formatoARS(r.efectivoContado), '']),
      ...e.liquidaciones.map((l) => ['Liquidación', l.codigo ?? l.id, l.choferNombre, l.fecha, formatoARS(l.efectivoRecibido), l.incluidaEnCierre ? 'ya incluida en un cierre de caja' : 'suelta']),
    ],
    styles: { fontSize: 8, cellPadding: 1.8 }, headStyles: head,
    columnStyles: { 4: { halign: 'right' }, 5: { textColor: 120 } },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  let y = (doc.lastAutoTable?.finalY ?? 60) + 6

  autoTable(doc, {
    startY: y,
    head: [['Efectivo', '']],
    body: [
      ['Cierres de caja', formatoARS(e.efectivo.cierresCaja)],
      ['Liquidaciones sueltas', formatoARS(e.efectivo.liquidacionesSueltas)],
      ['Teórico a entregar', formatoARS(e.efectivo.teorico)],
      ['Entregado por caja', `${formatoARS(e.efectivoEntregado)}${e.diferenciaEntrega ? `  (${MOTIVOS_DIFERENCIA_LIQUIDACION[e.diferenciaEntrega.motivo]}${e.diferenciaEntrega.nota ? ` · ${e.diferenciaEntrega.nota}` : ''})` : ''}`],
      ['Contado por tesorería', confirmada ? formatoARS(e.efectivoContado ?? 0) : 'pendiente'],
      ['Diferencia', confirmada ? `${(e.diferenciaEfectivo ?? 0) > 0 ? '+' : ''}${formatoARS(e.diferenciaEfectivo ?? 0)}` : '—'],
      ...(e.diferencia ? [['Motivo', `${MOTIVOS_DIFERENCIA_LIQUIDACION[e.diferencia.motivo]}${e.diferencia.nota ? ` · ${e.diferencia.nota}` : ''}`]] : []),
    ],
    styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: head,
    columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold' }, 1: { halign: 'right' } },
    margin: { left: 14, right: 90 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  y = (doc.lastAutoTable?.finalY ?? y) + 6

  if (e.cheques.length || e.retenciones.length) {
    const estado = (v: { recibido?: boolean; motivoNoEntregado?: string }) => !confirmada ? 'pendiente' : v.recibido === false ? `NO · ${v.motivoNoEntregado ?? ''}` : 'Sí'
    autoTable(doc, {
      startY: y, head: [['Valores en papel', 'Cliente', 'Recibo', 'Importe', 'Recibido en tesorería']],
      body: [
        ...e.cheques.map((ch) => [`Cheque ${ch.esEcheq ? 'electrónico ' : ''}${ch.numero} · ${ch.bancoNombre} · acredita ${ch.fechaAcreditacion}`, ch.clienteNombre, ch.numeroRecibo ?? '', formatoARS(ch.importe), estado(ch)]),
        ...e.retenciones.map((re) => [`Retención ${re.tipo.toUpperCase()} cert. ${re.nroCertificado}`, re.clienteNombre, re.numeroRecibo ?? '', formatoARS(re.importe), estado(re)]),
      ],
      foot: e.valoresFaltantes?.cantidad ? [[`${e.valoresFaltantes.cantidad} valor(es) no recibido(s) por tesorería`, '', '', formatoARS(e.valoresFaltantes.total), '']] : undefined,
      styles: { fontSize: 8, cellPadding: 1.8 }, headStyles: head, footStyles: { fillColor: [254, 226, 226], textColor: [153, 27, 27], fontStyle: 'bold' },
      columnStyles: { 3: { halign: 'right' }, 4: { cellWidth: 38 } }, margin: { left: 14, right: 14 },
    })
    // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 6
  }

  // Firmas: izquierda quien entrega (caja), derecha quien recibe (tesorería).
  if (y > pageH - 50) { doc.addPage(); y = 20 }
  doc.setFontSize(9); doc.setTextColor(80)
  doc.text('Entregó (caja)', 14, y + 4)
  doc.text('Recibió (tesorería)', pageW - 88, y + 4)
  if (e.firmaEntrega) { try { doc.addImage(e.firmaEntrega, 'PNG', 14, y + 6, 50, 20) } catch { /* firma inválida: se omite */ } }
  if (e.firmaRecibe)  { try { doc.addImage(e.firmaRecibe,  'PNG', pageW - 88, y + 6, 50, 20) } catch { /* idem */ } }
  doc.setDrawColor(150); doc.setLineWidth(0.3)
  doc.line(14, y + 27, 74, y + 27); doc.line(pageW - 88, y + 27, pageW - 28, y + 27)
  doc.setTextColor(0)
  doc.text(`${e.firmanteEntrega} · ${fechaHora(e.createdAt.toDate())}`, 14, y + 31)
  doc.text(confirmada ? `${e.firmanteRecibe ?? e.recibidoPor?.nombre ?? ''}${e.confirmadaEn ? ` · ${fechaHora(e.confirmadaEn.toDate())}` : ''}` : 'Pendiente de confirmación', pageW - 88, y + 31)
  doc.setFontSize(8); doc.setTextColor(120)
  doc.text(`Generado ${new Date().toLocaleString('es-AR')} · Rolito app`, pageW - 14, pageH - 8, { align: 'right' })

  if (opts.descargar === false) return doc.output('blob')
  doc.save(nombreArchivoActa(e))
}
