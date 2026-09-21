import { fetchImageAsBase64 } from './pdf'
import { NOMBRE_EMPRESA } from './tangoEmpresas'
import { finTabla, salidaPdf, encabezadoA4, ESTILO_CABECERA_TABLA } from './pdfBase'
import type { EmpresaTango } from '@/types'
import type { ResumenCuenta } from './resumenCuenta'

/**
 * RESUMEN DE CUENTA para mandarle al cliente (2026-09-20).
 *
 * La composición de saldos dice qué debe hoy; esto dice qué pasó entre dos
 * fechas, con el saldo corriendo. Es lo que resuelve el "yo esto lo pagué".
 *
 * Una SECCIÓN POR EMPRESA, cada una completa y cerrada: saldo inicial,
 * movimientos, saldo final. Nunca intercaladas — Redonhielo y Rolito son dos
 * cuentas distintas y un saldo mezclado no coincide con ningún papel de Tango.
 * Arriba, los totales de las dos juntos, que es lo que el cliente pregunta.
 *
 * Es informativo, no un comprobante: lleva el sello de cuándo se tomó el dato.
 */

export interface SeccionResumen {
  empresa:  EmpresaTango
  /** Código de cliente en esa empresa; vacío = consolidado de todas las sucursales. */
  codigo:   string
  resumen:  ResumenCuenta
}

export interface DatosResumenCuenta {
  cliente: { razonSocial: string; cuit?: string }
  secciones:   SeccionResumen[]
  desde:       string   // yyyy-MM-dd
  hasta:       string
  /** Etiqueta de la sucursal elegida ('' = todas). */
  sucursal?:   string
  datosAl:     Date | null
  generadoPor: string
  fecha:       Date
}

const money = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fechaCorta = (iso: string | undefined) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}
const fechaHora = (d: Date) => d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

export function nombreArchivoResumenCuenta(d: Pick<DatosResumenCuenta, 'cliente' | 'desde' | 'hasta'>): string {
  const slug = d.cliente.razonSocial.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40)
  return `resumen-cuenta-${slug || 'cliente'}-${d.desde}_${d.hasta}.pdf`
}

export async function generateResumenCuentaPdf(d: DatosResumenCuenta, opts: { descargar?: boolean } = {}): Promise<Blob> {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const logo  = await fetchImageAsBase64('/logo-rolito.png')

  encabezadoA4({ doc, pageW, logo }, 'Resumen de cuenta',
    `Del ${fechaCorta(d.desde)} al ${fechaCorta(d.hasta)}`, { tamSubtitulo: 9 })

  const filasCliente: string[][] = [['Cliente', d.cliente.razonSocial]]
  if (d.cliente.cuit) filasCliente.push(['CUIT', d.cliente.cuit])
  if (d.sucursal) filasCliente.push(['Sucursal', d.sucursal])
  filasCliente.push(['Datos', d.datosAl
    ? `Tomados de Tango al ${fechaHora(d.datosAl)}`
    : 'Sin datos de Tango para este cliente'])
  // El total de las dos empresas, que es la pregunta que trae el cliente.
  if (d.secciones.length > 1) {
    const total = d.secciones.reduce((s, x) => s + x.resumen.saldoFinal, 0)
    filasCliente.push(['Saldo total', `${money(total)}  (${d.secciones.map((s) => `${NOMBRE_EMPRESA[s.empresa]} ${money(s.resumen.saldoFinal)}`).join(' · ')})`])
  }
  autoTable(doc, {
    startY: 32, theme: 'plain', body: filasCliente,
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 } },
    margin: { left: 14, right: 14 },
  })
  let y = finTabla(doc, 60) + 4

  for (const sec of d.secciones) {
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(`${NOMBRE_EMPRESA[sec.empresa]}${sec.codigo ? ` — ${sec.codigo}` : ''}`, 14, y)
    doc.setFont('helvetica', 'normal')
    y += 2

    const { resumen } = sec
    const filas: (string | number)[][] = [
      [fechaCorta(d.desde), 'Saldo anterior', '', '', money(resumen.saldoInicial)],
      ...resumen.movimientos.map((m) => [
        fechaCorta(m.fecha),
        `${m.tipo} ${m.numero}`.trim(),
        m.debe ? money(m.debe) : '',
        m.haber ? money(m.haber) : '',
        money(m.saldo),
      ]),
    ]

    autoTable(doc, {
      startY: y + 2,
      head: [['Fecha', 'Comprobante', 'Debe', 'Haber', 'Saldo']],
      body: filas,
      // El renglón final repite el saldo: si no coincide con el de arriba, se ve.
      foot: [['', `Totales del período`, money(resumen.totalDebe), money(resumen.totalHaber), money(resumen.saldoFinal)]],
      theme: 'striped',
      headStyles: ESTILO_CABECERA_TABLA,
      footStyles: { fillColor: [245, 244, 240], textColor: 20, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 1.6 },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 62 },
        2: { halign: 'right', cellWidth: 32 },
        3: { halign: 'right', cellWidth: 32 },
        4: { halign: 'right', cellWidth: 36 },
      },
      margin: { left: 14, right: 14 },
    })
    y = finTabla(doc, y) + 8
  }

  if (!d.secciones.length) {
    doc.setFontSize(11)
    doc.text('Sin movimientos en el período.', 14, y + 4)
    y += 12
  }

  doc.setFontSize(8)
  doc.setTextColor(110)
  doc.text(
    `Resumen informativo generado por ${d.generadoPor} el ${fechaHora(d.fecha)}. No reemplaza a los comprobantes.`,
    14, Math.min(y + 4, doc.internal.pageSize.getHeight() - 10),
  )
  doc.setTextColor(0)

  return salidaPdf(doc, nombreArchivoResumenCuenta(d), opts.descargar)
}
