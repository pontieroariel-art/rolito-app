import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import type { VentaCamion } from '@/types'
import { comprobanteListoParaMail, mailDeVenta } from './mailDeVenta'

const base = {
  id: 'v1', camionId: '', choferId: 'ch', choferNombre: 'Walter', clienteId: 'c1', clienteNombre: 'COMPIL S.R.L.',
  items: [{ productoId: 'p', nombre: 'Hielo bolsa 2kg', cantidad: 80, precioUnitario: 1720 }], total: 137600,
  fecha: Timestamp.fromDate(new Date(2026, 8, 10, 16, 0)), pedidoId: null,
} as unknown as VentaCamion

const remito = { ...base, canal: 'contado', formaPago: 'cuenta_corriente', comprobanteInterno: { tipo: 'remito', puntoVenta: 1105, numero: 446 } } as VentaCamion
const factura = { ...base, canal: 'contado', formaPago: 'contado_efectivo', factura: { estado: 'emitida', cbteTipo: 6, puntoVenta: 1104, numero: 62, cae: '123' } } as unknown as VentaCamion

describe('mailDeVenta', () => {
  it('el remito lleva fecha y detalle, sin importe', () => {
    const m = mailDeVenta(remito)
    expect(m.asunto).toMatch(/^Remito .* — COMPIL S\.R\.L\.$/)
    expect(m.presentacion.emoji).toBe('🚚')
    expect(m.presentacion.filas.map((f) => f.label)).toEqual(['Fecha', 'Detalle'])
    expect(m.presentacion.filas[1].value).toBe('80 × Hielo bolsa 2kg')
    expect(m.clienteUid).toBe('c1')
  })
  it('la factura lleva el importe', () => {
    const m = mailDeVenta(factura)
    expect(m.presentacion.emoji).toBe('🧾')
    expect(m.presentacion.filas.map((f) => f.label)).toEqual(['Fecha', 'Importe', 'Detalle'])
  })
})

describe('comprobanteListoParaMail', () => {
  it('remito: con número; factura ARCA: recién con CAE', () => {
    expect(comprobanteListoParaMail(remito)).toBe(true)
    expect(comprobanteListoParaMail({ ...remito, comprobanteInterno: undefined })).toBe(false)
    expect(comprobanteListoParaMail(factura)).toBe(true)
    expect(comprobanteListoParaMail({ ...factura, factura: { ...factura.factura!, estado: 'incierta', cae: null } } as unknown as VentaCamion)).toBe(false)
    expect(comprobanteListoParaMail({ ...factura, factura: undefined })).toBe(false)
  })
})
