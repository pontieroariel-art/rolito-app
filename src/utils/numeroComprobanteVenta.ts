import type { VentaVentanilla } from '@/types'

/** "factura 01104-00000505", "factura X 00000043", "remito 00000120" o '' (2026-09-24: compartido entre Liquidación de caja y su acta). */
export const numeroComprobanteVenta = (v: Pick<VentaVentanilla, 'factura' | 'comprobanteInterno'>): string => {
  if (v.factura?.puntoVenta && v.factura.numero) return `factura ${String(v.factura.puntoVenta).padStart(5, '0')}-${String(v.factura.numero).padStart(8, '0')}`
  if (v.comprobanteInterno?.numero) return `${v.comprobanteInterno.tipo === 'facturaX' ? 'factura X' : 'remito'} ${String(v.comprobanteInterno.numero).padStart(8, '0')}`
  return ''
}
