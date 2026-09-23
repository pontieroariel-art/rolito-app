import type { UserProfile, VentaCamion, VentaVentanilla } from '@/types'
import type { FacturaArcaData } from './facturaArcaPdf'
import { armarFacturaDeVenta } from './facturaDeVenta'
import { armarRemito, type CaiRemito, type RemitoData } from './comprobanteInterno'
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
  /** Armar el remito de cuenta corriente (2026-09-16); si la venta no sale por remito, `motivoRemito` lo explica. */
  incluirRemito?: boolean
  /** CAI del talonario de remitos de Redonhielo: con él el remito sale R, sin él X. */
  cai?:           CaiRemito | null
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
  remito?:      RemitoData
  turno?:       TurnoTicketData
  copiasTurno?: number
  /** Se pidió la factura y no se pudo armar (sin factura, rechazada…). */
  motivoFactura?: string
  /** Se pidió el remito y no se pudo armar (la venta no sale por remito). */
  motivoRemito?:  string
}

/**
 * La venta de ventanilla con la forma de la del camión, para los armadores de
 * comprobantes que son comunes a los dos (`armarRemito`, `armarFacturaX`,
 * `armarNotaCreditoX`…): quien vendió es el cajero y no hay camión. Tipado de
 * verdad (auditoría 2026-09-22, antes eran cuatro copias con `as unknown as`):
 * si VentaCamion gana un campo obligatorio, esto deja de compilar en vez de
 * salir con undefined en el papel. Una venta ocasional no tiene clienteId.
 *
 * `quienEntrega`: en el papel va el muellero que entregó en vez del cajero
 * (Tesorería en vivo lo usa así).
 */
export function ventanillaComoVentaCamion(v: VentaVentanilla, opts: { quienEntrega?: boolean } = {}): VentaCamion {
  return {
    ...v,
    camionId:     '',
    choferId:     v.cajaId,
    choferNombre: opts.quienEntrega ? (v.entregadoPor?.nombre ?? v.cajaNombre) : v.cajaNombre,
    clienteId:    v.clienteId ?? '',
  }
}

/** Lo que llega de cualquiera de las dos colecciones, con la forma del camión. */
export const comoVentaCamion = (v: VentaCamion | VentaVentanilla): VentaCamion =>
  'cajaId' in v ? ventanillaComoVentaCamion(v) : v

export function partesTicketDeVenta(v: VentaVentanilla, opts: OpcionesTicketDeVenta): PartesTicketDeVenta {
  const out: PartesTicketDeVenta = {}
  if (opts.incluirFactura) {
    const armado = armarFacturaDeVenta(v, opts.cliente)
    if (armado.ok) out.factura = armado.datos
    else out.motivoFactura = armado.motivo
  }
  if (opts.incluirRemito) {
    const armado = armarRemito(ventanillaComoVentaCamion(v), opts.cliente, opts.cai ?? null)
    if (armado.ok) out.remito = { ...armado.datos, entrega: { chofer: `ventanilla · ${v.cajaNombre}` } }
    else out.motivoRemito = armado.motivo
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
