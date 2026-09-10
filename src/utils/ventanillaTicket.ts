// Los dos papeles que la ventanilla le da al público, en formato ticket de
// 80 mm para la impresora térmica del mostrador (ver ticketTermico.ts):
//
//  - la factura electrónica de ARCA, con los mismos datos que la versión A4
//    (`facturaArcaPdf.ts`: emisor, cliente, renglones, totales, CAE y el QR
//    de la RG 4892) reacomodados a una columna;
//  - el comprobante de turno, con el número bien grande y el QR que abre
//    /turnos/{planta}?turno=N. Es contra lo que muelle entrega.
//
// Cuando la venta se factura salen los dos en un mismo PDF (dos páginas, un
// solo diálogo): primero la factura, después el turno.

import type { jsPDF } from 'jspdf'
import { PLANTA_INFO } from './constants'
import { EMISOR_ARCA, FacturaArcaData } from './facturaArcaPdf'
import { EMISOR_ROLITO } from './emisores'
import { urlQrArca } from './arcaQr'
import { generateQrDataUrl } from './qr'
import {
  DibujoTicket, armarPdfTickets, campo, fila, imagenCentrada, separador, texto,
} from './ticketTermico'

const money = (n: number) => `$ ${n.toFixed(2)}`
const fecha = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
const fechaHora = (d: Date) =>
  `${fecha(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export const nroComprobante = (puntoVenta: number, numero: number) =>
  `${String(puntoVenta).padStart(5, '0')}-${String(numero).padStart(8, '0')}`

// ── Factura electrónica ──────────────────────────────────────────────────────
export function dibujoFacturaArcaTicket(d: FacturaArcaData): DibujoTicket {
  return async (doc: jsPDF, y: number) => {
    const emisor = d.emisor ?? EMISOR_ARCA
    const nro = nroComprobante(d.puntoVenta, d.numero)

    y = texto(doc, emisor.razonSocial.toUpperCase(), y + 3, { tam: 11, negrita: true, align: 'center' })
    y = texto(doc, emisor.domicilio, y, { tam: 7, align: 'center' })
    y = texto(doc, `Tel. ${emisor.telefono}`, y, { tam: 7, align: 'center' })
    y = texto(doc, `CUIT ${emisor.cuit} · IIBB ${emisor.ingresosBrutos}`, y, { tam: 7, align: 'center' })
    y = texto(doc, `Inicio de actividades ${emisor.inicioActividad}`, y, { tam: 7, align: 'center' })
    y = texto(doc, `IVA ${emisor.condicionIva}`, y, { tam: 7, align: 'center' })
    y = separador(doc, y + 1)

    y = texto(doc, `${d.tituloDocumento ?? 'FACTURA'} ${d.letra}`, y + 2, { tam: d.tituloDocumento ? 11 : 14, negrita: true, align: 'center' })
    y = texto(doc, `Cód. ${d.codigoTipo}`, y - 0.5, { tam: 6.5, align: 'center' })
    y = texto(doc, `N° ${nro}`, y + 0.5, { tam: 10, negrita: true, align: 'center' })
    y = texto(doc, `Fecha de emisión: ${fecha(d.fechaEmision)}`, y, { tam: 7.5, align: 'center' })
    y = separador(doc, y + 1)

    y = campo(doc, 'Cliente:', d.cliente.razonSocial, y + 1)
    if (d.cliente.sucursal) y = campo(doc, 'Sucursal:', d.cliente.sucursal, y)
    y = campo(doc, 'CUIT:', d.cliente.cuit || 'Consumidor final sin identificar', y)
    if (d.cliente.condicionIva) y = campo(doc, 'IVA:', d.cliente.condicionIva, y)
    if (d.cliente.domicilio) y = campo(doc, 'Domicilio:', d.cliente.domicilio, y)
    y = campo(doc, 'Cond. de venta:', d.cliente.condicionVenta, y)
    if (d.comprobanteAsociado) y = campo(doc, 'Anula:', d.comprobanteAsociado, y)
    if (d.cliente.vendedor) y = campo(doc, 'Vendedor:', d.cliente.vendedor, y)
    y = separador(doc, y + 1)

    y = fila(doc, 'Cant. x Precio unit.', 'Total', y + 1, { tam: 7, negrita: true })
    for (const r of d.renglones) {
      y = texto(doc, r.descripcion, y + 0.5, { tam: 8 })
      y = fila(doc, `${r.cantidad.toFixed(2)} ${r.unidad} x ${r.precioUnitario.toFixed(2)}`, money(r.total), y, { tam: 8 })
      for (const nota of r.notas ?? []) y = texto(doc, nota, y, { tam: 7 })
    }
    y = separador(doc, y + 1)

    const t = d.totales
    y = fila(doc, 'Subtotal', money(t.subtotal), y + 1, { tam: 8 })
    if (t.bonificaciones) y = fila(doc, 'Bonificaciones', money(t.bonificaciones), y, { tam: 8 })
    y = fila(doc, 'IVA', money(t.iva), y, { tam: 8 })
    y = fila(doc, 'Perc. IIBB CABA', money(t.percIibbCaba), y, { tam: 8 })
    y = fila(doc, 'TOTAL', money(t.total), y + 1.5, { tam: 12, negrita: true })
    y = texto(doc, 'Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)', y + 0.5, { tam: 6.5, align: 'center' })
    if (d.vencimiento) {
      y = fila(doc, `Vence ${fecha(d.vencimiento.fecha)}`, money(d.vencimiento.importe), y + 1, { tam: 7.5 })
    }
    y = separador(doc, y + 1)

    const qr = await generateQrDataUrl(urlQrArca({
      fechaEmision: d.fechaEmision,
      cuitEmisor:   emisor.cuit,
      puntoVenta:   d.puntoVenta,
      codigoTipo:   d.codigoTipo,
      numero:       d.numero,
      importeTotal: t.total,
      cuitReceptor: d.cliente.cuit,
      cae:          d.cae,
    }))
    y = imagenCentrada(doc, qr, y + 1, 30)
    y = texto(doc, `CAE: ${d.cae}`, y + 1, { tam: 8, negrita: true, align: 'center' })
    y = texto(doc, `Vto. CAE: ${fecha(d.caeVto)}`, y, { tam: 8, align: 'center' })
    y = texto(doc, 'Comprobante autorizado por ARCA', y + 0.5, { tam: 6.5, align: 'center' })
    const razon = emisor.razonSocial.replace(/\s*SA$/, ' S.A.')
    y = texto(doc,
      'La mora en el pago producirá un interés punitorio del 0,2% diario acumulativo. '
      + `Domicilio de pago y lugar de cumplimiento: el de ${razon}`,
      y + 2, { tam: 6, align: 'center' })
    return y
  }
}

// ── Comprobante de turno ─────────────────────────────────────────────────────
export interface TurnoTicketData {
  plantaId:      'torcuato' | 'merlo'
  canal:         'contado' | 'promo'
  clienteNombre: string
  clienteCuit?:  string
  /** Sucursal a la que va la carga, si la cuenta tiene varias (2026-09-10). */
  sucursal?:     string
  items:         { nombre: string; cantidad: number; precioUnitario: number }[]
  total:         number
  formaPago:     string
  cajaNombre:    string
  fecha:         Date
  turno:         number
  /** URL pública de seguimiento de la fila (se codifica en el QR). */
  urlTurno:      string
  /** Número de factura ya emitida, si la hubo, para vincular los dos papeles. */
  facturaNro?:   string
  /** Qué copia es este papel (original/duplicado/triplicado). Ausente = sin leyenda. */
  copia?:        CopiaTicket
}

// ── Copias del comprobante de turno ──────────────────────────────────────────
// Mientras muelle y seguridad no tengan sus pantallas (2026-09-09, decisión de
// Ariel), el turno sale por triplicado: el original se lo queda el cliente, el
// duplicado lo firma muelle al entregar y el triplicado lo retiene seguridad
// en el portón. Cada copia lleva su leyenda y, salvo el original, un renglón
// de firma propio. La cantidad se configura por planta (config/ventanilla).
export interface CopiaTicket {
  leyenda:     string
  /** Renglón de firma adicional al del cliente ("Entregó (muelle)"…). */
  firmaExtra?: string
}

export const COPIAS_TICKET: CopiaTicket[] = [
  { leyenda: 'ORIGINAL · CLIENTE' },
  { leyenda: 'DUPLICADO · MUELLE',     firmaExtra: 'Entregó (muelle)' },
  { leyenda: 'TRIPLICADO · SEGURIDAD', firmaExtra: 'Salida (seguridad)' },
]
export const COPIAS_TICKET_DEFAULT = 3
export const COPIAS_TICKET_MAX = COPIAS_TICKET.length

/** Cantidad de copias válida: entero entre 1 y 3; cualquier otra cosa → default. */
export function normalizarCopiasTicket(n: unknown): number {
  const v = Number(n)
  return Number.isInteger(v) && v >= 1 && v <= COPIAS_TICKET_MAX ? v : COPIAS_TICKET_DEFAULT
}

/** Con una sola copia no hace falta leyenda; con más, cada una dice cuál es. */
export function copiaTicket(indice: number, total: number): CopiaTicket | undefined {
  return total > 1 ? COPIAS_TICKET[indice] : undefined
}

const FORMA_PAGO: Record<string, string> = {
  contado_efectivo: 'Efectivo', contado_transferencia: 'Transferencia', cuenta_corriente: 'Cuenta corriente',
}

export function dibujoTurnoTicket(v: TurnoTicketData): DibujoTicket {
  return async (doc: jsPDF, y: number) => {
    const planta = PLANTA_INFO[v.plantaId]
    const pesos = (n: number) => `$${n.toLocaleString('es-AR')}`

    // La promo es de Rolito: el papel sale a su nombre (Ariel, 2026-09-09).
    const encabezado = v.canal === 'promo' ? EMISOR_ROLITO.razonSocial : planta.razonSocial
    y = texto(doc, encabezado.toUpperCase(), y + 3, { tam: 10, negrita: true, align: 'center' })
    y = texto(doc, `Planta ${planta.localidad}`, y, { tam: 7.5, align: 'center' })
    y = texto(doc, 'COMPROBANTE DE VENTANILLA', y + 1, { tam: 8.5, negrita: true, align: 'center' })
    y = texto(doc, fechaHora(v.fecha), y, { tam: 7.5, align: 'center' })
    if (v.copia) y = texto(doc, v.copia.leyenda, y + 1, { tam: 8, negrita: true, align: 'center' })
    y = separador(doc, y + 1)

    y = texto(doc, 'TU TURNO', y + 3, { tam: 11, negrita: true, align: 'center' })
    y = texto(doc, String(v.turno), y + 15, { tam: 54, negrita: true, align: 'center', interlineado: 4 })
    const qr = await generateQrDataUrl(v.urlTurno)
    y = imagenCentrada(doc, qr, y + 2, 32)
    y = texto(doc, 'Esperá en tu vehículo. Escaneá el QR para seguir la fila desde tu teléfono y ver cuándo te toca.', y, { tam: 7, align: 'center' })
    y = separador(doc, y + 1)

    y = campo(doc, 'Cliente:', v.clienteCuit ? `${v.clienteNombre} - CUIT ${v.clienteCuit}` : v.clienteNombre, y + 1)
    if (v.sucursal) y = campo(doc, 'Sucursal:', v.sucursal, y)
    y = campo(doc, 'Canal:', v.canal === 'contado' ? 'Venta Contado (Redonhielo)' : 'Promo (Rolito)', y)
    y = campo(doc, 'Pago:', FORMA_PAGO[v.formaPago] ?? v.formaPago, y)
    if (v.facturaNro) y = campo(doc, 'Factura:', v.facturaNro, y)
    y = separador(doc, y + 1)

    for (const i of v.items) {
      y = fila(doc, `${i.cantidad} x ${i.nombre}`, pesos(i.precioUnitario * i.cantidad), y + 0.5, { tam: 8 })
    }
    y = fila(doc, 'TOTAL', pesos(v.total), y + 1.5, { tam: 11, negrita: true })
    y = separador(doc, y + 1)

    y = texto(doc, 'Presentá este comprobante en muelle para retirar la mercadería.', y + 1, { tam: 7, align: 'center' })
    const renglonFirma = (etiqueta: string) => {
      y += 10
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.2)
      doc.line(16, y, 64, y)
      y = texto(doc, etiqueta, y + 3, { tam: 6.5, align: 'center' })
    }
    renglonFirma('Firma del cliente')
    if (v.copia?.firmaExtra) renglonFirma(v.copia.firmaExtra)
    y = texto(doc, `Caja: ${v.cajaNombre}`, y + 1, { tam: 7, align: 'center' })
    return y
  }
}

// ── Armado ───────────────────────────────────────────────────────────────────
/**
 * PDF de 80 mm con la factura (si hay, una sola vez) y el turno, en ese orden.
 * `copiasTurno` (1..3, default 1) repite el turno con la leyenda de cada copia.
 */
export function generateTicketsVentanilla(partes: { factura?: FacturaArcaData; turno?: TurnoTicketData; copiasTurno?: number }): Promise<Blob> {
  const dibujos: DibujoTicket[] = []
  if (partes.factura) dibujos.push(dibujoFacturaArcaTicket(partes.factura))
  if (partes.turno) {
    const total = Math.min(Math.max(partes.copiasTurno ?? 1, 1), COPIAS_TICKET_MAX)
    for (let i = 0; i < total; i++) dibujos.push(dibujoTurnoTicket({ ...partes.turno, copia: copiaTicket(i, total) }))
  }
  return armarPdfTickets(dibujos)
}
