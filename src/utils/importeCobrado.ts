// Lo que se COBRÓ en una venta, para contar plata (2026-09-14).
//
// `venta.total` es la suma de precios de lista, y las listas de Tango son
// netas (config/arca.preciosIncluyenIva = false): cuando la venta va a factura
// electrónica, el cliente paga el total de la factura (neto + 21 % de IVA +
// percepción de IIBB), no `total`. Hasta hoy el cierre de caja, la liquidación
// del repartidor y el tablero de tesorería sumaban `total`, así que cada
// factura A o B de contado dejaba el IVA fuera del "a rendir" (14 días: 6
// ventas, $175.599 sin contar). La venta de Feijoo del 14/09 lo hizo visible.
//
// Regla: si la venta tiene factura de ARCA con importes, lo cobrado es el
// total de la factura; si no (cuenta corriente con remito, promo con factura
// X de Rolito que no lleva IVA, o factura todavía en curso), es `total`.
export interface VentaConImporte {
  total: number
  factura?: { importes?: { total: number } | null } | null
}

export function importeCobrado(v: VentaConImporte): number {
  const t = v.factura?.importes?.total
  return typeof t === 'number' && Number.isFinite(t) ? t : v.total
}

/** IVA y percepción que la factura agregó por encima del precio de lista (0 si no hay factura). */
export function impuestosDe(v: VentaConImporte): number {
  return Math.round((importeCobrado(v) - v.total) * 100) / 100
}

export const sumaCobrada = (ventas: VentaConImporte[]): number => ventas.reduce((s, v) => s + importeCobrado(v), 0)
