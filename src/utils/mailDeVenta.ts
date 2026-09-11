import type { VentaCamion } from '@/types'
import { describirComprobante } from './comprobanteDeVenta'
import { tipoComprobanteInterno } from './comprobanteInterno'
import { formatoARS } from './money'

// Mail del comprobante de una venta del camión (factura ARCA, remito o
// factura X): mismo contenido para el envío manual desde Mis ventas
// (MenuComprobanteVenta) y para el automático al registrar la venta
// (services/envioAutomaticoVentasService, 2026-09-11). El importe va solo en
// las facturas: el remito es constancia de entrega y su mail no lleva plata.

export interface MailDeVenta {
  asunto:        string
  mensaje:       string
  comprobante:   { tipo: string; numero: string }
  clienteUid?:   string
  clienteNombre: string
  presentacion:  { titulo: string; emoji: string; filas: { label: string; value: string }[] }
}

export function mailDeVenta(venta: VentaCamion): MailDeVenta {
  const d = describirComprobante(venta)
  const titulo = `${d.etiqueta}${d.numero ? ` ${d.numero}` : ''}`
  const fecha = venta.fecha.toDate().toLocaleDateString('es-AR')
  const esFactura = d.etiqueta.startsWith('Factura')
  return {
    asunto: `${titulo} — ${venta.clienteNombre}`,
    mensaje: `Te enviamos adjunto el comprobante de la entrega del ${fecha}.`,
    comprobante: { tipo: d.etiqueta, numero: d.numero || venta.id },
    clienteUid: venta.clienteId || undefined,
    clienteNombre: venta.clienteNombre,
    presentacion: {
      titulo, emoji: esFactura ? '🧾' : '🚚',
      filas: [
        { label: 'Fecha', value: fecha },
        ...(venta.ordenCompra ? [{ label: 'Orden de compra', value: venta.ordenCompra }] : []),
        ...(esFactura ? [{ label: 'Importe', value: formatoARS(venta.total) }] : []),
        ...(venta.items.length ? [{ label: 'Detalle', value: venta.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', ').slice(0, 200) }] : []),
      ],
    },
  }
}

/**
 * ¿Ya está el papel para mandar? Remito / factura X: apenas tiene número
 * (sale del teléfono). Factura ARCA: recién con el CAE, que llega del server
 * segundos después de registrar la venta (hasta entonces se espera).
 */
export function comprobanteListoParaMail(venta: Pick<VentaCamion, 'canal' | 'formaPago' | 'total' | 'comprobanteInterno' | 'factura'>): boolean {
  const interno = tipoComprobanteInterno(venta)
  if (interno) return !!venta.comprobanteInterno
  return venta.factura?.estado === 'emitida' && !!venta.factura.cae
}
