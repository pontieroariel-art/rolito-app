// Clave única de una factura, con el formato en que Tango numera los
// comprobantes: letra + punto de venta (5 dígitos) + número (8 dígitos), por
// ejemplo 'A0110400000062'. Es el mismo `numero` que traen los comprobantes de
// la composición de saldos (saldosTango) y el que la app manda al Facturador
// de Tango (functions/src/services/tango/factura.ts → numeroComprobanteTango).
// Sirve de puente entre una factura adeudada y su PDF (venta de la app o
// factura archivada por administración). Puro, sin Firebase.

export type LetraFactura = 'A' | 'B' | 'C' | 'X'

export interface ClaveFactura {
  letra:      LetraFactura
  puntoVenta: number
  numero:     number
}

export const LETRA_POR_CBTE_TIPO: Record<number, LetraFactura> = { 1: 'A', 6: 'B', 11: 'C' }

export function claveFactura(letra: LetraFactura, puntoVenta: number, numero: number): string {
  return `${letra}${String(puntoVenta).padStart(5, '0')}${String(numero).padStart(8, '0')}`
}

/** 'A0110400000062' → { letra: 'A', puntoVenta: 1104, numero: 62 }; null si no tiene ese formato. */
export function parsearClaveTango(numeroTango: string | null | undefined): ClaveFactura | null {
  const m = /^([ABCX])(\d{5})(\d{8})$/.exec((numeroTango ?? '').trim().toUpperCase())
  if (!m) return null
  return { letra: m[1] as LetraFactura, puntoVenta: Number(m[2]), numero: Number(m[3]) }
}

/** 'A 01104-00000062', para mostrar. */
export function formatoFactura(c: ClaveFactura): string {
  return `${c.letra} ${String(c.puntoVenta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`
}
