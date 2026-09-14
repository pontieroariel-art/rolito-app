import type { UserProfile, VentaVentanilla } from '@/types'
import type { FacturaArcaData } from './facturaArcaPdf'
import { armarFacturaDeVenta } from './facturaDeVenta'
import { clienteImpreso } from './clienteImpreso'
import { nroFacturaArca } from './comprobanteDeVenta'
import type { TurnoTicketData } from './ventanillaTicket'

// Los datos del ticket de 80 mm de una venta de ventanilla, en un solo lugar
// (2026-09-14; antes vivían inline en VentanillaPage.imprimir): la factura
// electrónica (si la venta la tiene) y el comprobante de turno, listos para
// `generateTicketsVentanilla` / `generateTicketsVentanillaSeparados`. Lo usan
// la ventanilla (imprimir) y Tesorería en vivo (ver el ticket de cada venta).

export interface OpcionesTicketDeVenta {
  /** Armar la factura de ARCA (si la venta no la tiene, `motivoFactura` lo explica). */
  incluirFactura: boolean
  /** Armar el comprobante de turno. */
  incluirTurno:   boolean
  /** Copias del turno (config/ventanilla de la planta). Ausente = una. */
  copiasTurno?:   number
  /** Ficha del cliente registrado: CUIT, condición de IVA, sucursal. Sin ficha sale con lo que dice la venta. */
  cliente?:       UserProfile
  /** Origen de la URL pública del turno (default: el de la página). */
  origen?:        string
}

export interface PartesTicketDeVenta {
  factura?:     FacturaArcaData
  turno?:       TurnoTicketData
  copiasTurno?: number
  /** Se pidió la factura y no se pudo armar (sin factura, rechazada…). */
  motivoFactura?: string
}

export function partesTicketDeVenta(v: VentaVentanilla, opts: OpcionesTicketDeVenta): PartesTicketDeVenta {
  const out: PartesTicketDeVenta = {}
  if (opts.incluirFactura) {
    const armado = armarFacturaDeVenta(v, opts.cliente)
    if (armado.ok) out.factura = armado.datos
    else out.motivoFactura = armado.motivo
  }
  if (opts.incluirTurno) {
    const origen = opts.origen ?? (typeof window !== 'undefined' ? window.location.origin : '')
    out.turno = {
      plantaId:      v.plantaId,
      canal:         v.canal,
      clienteNombre: v.clienteNombre,
      clienteCuit:   v.clienteOcasional?.cuit ?? opts.cliente?.cuit,
      // Sucursal a la que va la carga (cuentas con varias): muelle entrega contra este papel.
      sucursal:      v.clienteId ? clienteImpreso(v, opts.cliente).sucursal || undefined : undefined,
      items:         v.items,
      total:         v.total,
      formaPago:     v.formaPago,
      cajaNombre:    v.cajaNombre,
      fecha:         v.fecha.toDate(),
      turno:         v.turno,
      urlTurno:      `${origen}/turnos/${v.plantaId}?turno=${v.turno}`,
      facturaNro:    v.factura?.estado === 'emitida' ? nroFacturaArca(v) : undefined,
    }
  }
  if (opts.copiasTurno !== undefined) out.copiasTurno = opts.copiasTurno
  return out
}
