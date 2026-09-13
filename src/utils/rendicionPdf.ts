import type { Rendicion } from '@/types'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS } from '@/types'
import { formatoARS } from './money'
import { ESTILO_CABECERA_TABLA, encabezadoA4, firmaA4, nuevoA4, pieA4, salidaPdf } from './pdfBase'

// PDF del cierre de caja de ventanilla (rendición de mostrador, 2026-09-09).
// Mismo estilo que la liquidación del repartidor (pdf.ts → generateLiquidacion),
// en archivo aparte para no seguir engordando pdf.ts.

export const nombreArchivoRendicion = (r: Pick<Rendicion, 'fecha' | 'sujetoNombre' | 'codigo'>) =>
  `cierre-caja-${r.fecha}-${r.sujetoNombre.toLowerCase().replace(/\s+/g, '-')}-${r.codigo}.pdf`

export interface DetalleRendicionPdf {
  ventas?: { turno?: number; hora: Date; cliente: string; canal: string; formaPago: string; total: number; comprobante?: string }[]
  cobranzas?: { hora: Date; cliente: string; recibo?: string; efectivo: number; transferencia: number; cheques: number; retenciones: number }[]
}

export async function generateRendicionMostrador(r: Rendicion, detalle: DetalleRendicionPdf = {}, opts: { descargar?: boolean } = {}): Promise<Blob | void> {
  const base  = await nuevoA4()
  const { doc, autoTable, pageW } = base
  const hora  = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  const head  = ESTILO_CABECERA_TABLA

  encabezadoA4(base, 'Cierre de caja de ventanilla',
    `${r.codigo}   ·   ${PLANTAS[r.plantaId].label}   ·   ${r.sujetoNombre}   ·   ${r.fecha}`)

  // Plata: teórico por origen y cierre.
  const v = r.ventas, c = r.cobranzas
  autoTable(doc, {
    startY: 32,
    head: [['Concepto', 'Efectivo', 'Transferencia', 'Cta. cte.', 'Otros', 'Total']],
    body: [
      ['Ventas contado (Redonhielo)', formatoARS(v.contadoEfectivo), formatoARS(v.contadoTransferencia), formatoARS(v.cuentaCorriente), '', formatoARS(v.contadoEfectivo + v.contadoTransferencia + v.cuentaCorriente)],
      ['Ventas promo (Rolito)', formatoARS(v.promoEfectivo), formatoARS(v.promoTransferencia), formatoARS(v.promoCuentaCorriente), '', formatoARS(v.promoEfectivo + v.promoTransferencia + v.promoCuentaCorriente)],
      [`Cobranzas de mostrador (${c.cantidad})`, formatoARS(c.efectivo), formatoARS(c.transferencia), '', `${c.cheques.cantidad} cheques ${formatoARS(c.cheques.total)}${c.retenciones.cantidad ? ` · ${c.retenciones.cantidad} ret. ${formatoARS(c.retenciones.total)}` : ''}`, formatoARS(c.total)],
      [`Recibido de repartidores (${r.recibido.liquidaciones.length})`, formatoARS(r.recibido.efectivo), '', '', '', formatoARS(r.recibido.efectivo)],
    ],
    styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: head,
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  let y = (doc.lastAutoTable?.finalY ?? 60) + 6

  autoTable(doc, {
    startY: y,
    head: [['Cierre', '']],
    body: [
      ['Efectivo a rendir', formatoARS(r.efectivoARendir)],
      ['Efectivo contado', formatoARS(r.efectivoContado)],
      ['Diferencia', `${r.diferenciaEfectivo === 0 ? '' : r.diferenciaEfectivo > 0 ? '+' : ''}${formatoARS(r.diferenciaEfectivo)}`],
      ...(r.diferencia ? [['Motivo', `${MOTIVOS_DIFERENCIA_LIQUIDACION[r.diferencia.motivo]}${r.diferencia.nota ? ` · ${r.diferencia.nota}` : ''}`]] : []),
      ['Cerró', `${r.cerradaPor.nombre} · ${hora(r.hasta.toDate())}`],
      ['Validación de tesorería', r.validacion ? `${r.validacion.nombre} · ${r.validacion.fecha.toDate().toLocaleString('es-AR')}${r.validacion.nota ? ` · ${r.validacion.nota}` : ''}` : 'pendiente'],
    ],
    styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: head,
    columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold' }, 1: { halign: 'right' } },
    margin: { left: 14, right: 108 },
  })
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  const yCierre = doc.lastAutoTable?.finalY ?? y

  if (r.recibido.liquidaciones.length) {
    autoTable(doc, {
      startY: y,
      head: [['Repartidor', 'A rendir', 'Recibido', 'Dif.']],
      body: r.recibido.liquidaciones.map((l) => [l.choferNombre, formatoARS(l.efectivoARendir), formatoARS(l.efectivoRecibido), formatoARS(l.diferenciaEfectivo)]),
      styles: { fontSize: 8, cellPadding: 1.8 }, headStyles: head,
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: 108, right: 14 },
    })
  }
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  y = Math.max(yCierre, doc.lastAutoTable?.finalY ?? 0) + 6

  if (r.bultos.length) {
    autoTable(doc, {
      startY: y, head: [['Mercadería que salió del depósito por este cajero', 'Cantidad']],
      body: r.bultos.map((b) => [b.nombre, String(b.cantidad)]),
      styles: { fontSize: 8, cellPadding: 1.8 }, headStyles: head, columnStyles: { 1: { halign: 'right' } }, margin: { left: 14, right: 14 },
    })
    // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 6
  }

  if (r.cheques.length || r.retenciones.length) {
    autoTable(doc, {
      startY: y, head: [['Valores en papel a entregar', 'Cliente', 'Recibo', 'Importe', 'En mano']],
      body: [
        ...r.cheques.map((ch) => [`Cheque ${ch.esEcheq ? 'electrónico ' : ''}${ch.numero} · ${ch.bancoNombre} · acredita ${ch.fechaAcreditacion}`, ch.clienteNombre, ch.numeroRecibo ?? '', formatoARS(ch.importe), ch.recibido === false ? `NO · ${ch.motivoNoEntregado ?? ''}` : 'Sí']),
        ...r.retenciones.map((re) => [`Retención ${re.tipo.toUpperCase()} cert. ${re.nroCertificado}`, re.clienteNombre, re.numeroRecibo ?? '', formatoARS(re.importe), re.recibido === false ? `NO · ${re.motivoNoEntregado ?? ''}` : 'Sí']),
      ],
      styles: { fontSize: 8, cellPadding: 1.8 }, headStyles: head, columnStyles: { 3: { halign: 'right' }, 4: { cellWidth: 36 } }, margin: { left: 14, right: 14 },
    })
    // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 6
  }

  if (detalle.ventas?.length) {
    autoTable(doc, {
      startY: y, head: [['Turno', 'Hora', 'Cliente', 'Canal', 'Pago', 'Comprobante', 'Total']],
      body: detalle.ventas.map((x) => [x.turno != null ? String(x.turno) : '', hora(x.hora), x.cliente, x.canal, x.formaPago, x.comprobante ?? '', formatoARS(x.total)]),
      styles: { fontSize: 7.5, cellPadding: 1.5 }, headStyles: head, columnStyles: { 6: { halign: 'right' } }, margin: { left: 14, right: 14 },
    })
    // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 6
  }
  if (detalle.cobranzas?.length) {
    autoTable(doc, {
      startY: y, head: [['Hora', 'Cliente', 'Recibo', 'Efectivo', 'Transf.', 'Cheques', 'Retenc.']],
      body: detalle.cobranzas.map((x) => [hora(x.hora), x.cliente, x.recibo ?? '', formatoARS(x.efectivo), formatoARS(x.transferencia), formatoARS(x.cheques), formatoARS(x.retenciones)]),
      styles: { fontSize: 7.5, cellPadding: 1.5 }, headStyles: head, columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } }, margin: { left: 14, right: 14 },
    })
    // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 6
  }

  // Firma
  if (y > base.pageH - 45) { doc.addPage(); y = 20 }
  firmaA4(base, { x: 14, y, etiqueta: 'Firma de quien cierra la caja', firma: r.firma, aclaracion: r.firmante, conRaya: false })
  pieA4(base)

  return salidaPdf(doc, nombreArchivoRendicion(r), opts.descargar)
}
