import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { clasificarReparto, referenciasDelReparto } from './liquidacion'
import { describirComprobante, estadoTangoVenta, problemasDeVenta } from './comprobanteDeVenta'
import type { Cobranza, VentaCamion } from '@/types'

const ts = (h: number) => Timestamp.fromDate(new Date(2026, 8, 6, h, 0, 0))
const importes = (total: number) => ({ fecha: '', neto: 0, iva: 0, tributos: 0, total })
const venta = (over: Partial<VentaCamion>): VentaCamion => ({
  id: 'v', canal: 'contado', camionId: 'c', choferId: 'u', choferNombre: 'Chofer', clienteId: 'cli', clienteNombre: 'CLIENTE', clienteCodigoTango: 'FC.1',
  items: [{ productoId: 'bolsa_10kg', nombre: 'Bolsa 10 kg', cantidad: 1, precioUnitario: 1000 }], total: 1000, formaPago: 'contado_efectivo', fecha: ts(9), ...over,
})
const cob = (over: Partial<Cobranza>): Cobranza => ({
  id: 'c', origen: 'cobrador', registradoPor: { uid: 'u', nombre: 'Chofer' }, clienteId: 'cli', clienteNombre: 'CLIENTE', importe: 100, formaPago: 'mixto', fecha: ts(10),
  empresa: 'redonhielo', imputaciones: [], medios: { efectivo: 100, transferencia: 0, cheques: [], retenciones: [] }, ...over,
})

describe('clasificarReparto', () => {
  const ventas = [
    venta({ id: 'a', total: 48000, formaPago: 'contado_efectivo', factura: { estado: 'emitida', numero: 341, puntoVenta: 1, cbteTipo: 6, cae: 'x', caeFchVto: '', importes: importes(48000) }, tango: { estado: 'error', ultimoError: 'sin depósito' }, cambios: [{ productoId: 'cambio_bolsa_10kg', nombre: 'Cambio Bolsa 10 kg', cantidad: 2, precioUnitario: 0 }] }),
    venta({ id: 'b', total: 12000, formaPago: 'contado_transferencia', clienteId: 'cli2', clienteNombre: 'OTRO', factura: { estado: 'emitida', numero: 342, puntoVenta: 1, cbteTipo: 1, cae: 'x', caeFchVto: '', importes: importes(12000) }, tango: { estado: 'confirmado', facturaNumero: 'A0000100000342' } }),
    venta({ id: 'c', total: 2000, formaPago: 'cuenta_corriente', comprobanteInterno: { tipo: 'remito', puntoVenta: 1105, numero: 41 }, tango: { estado: 'confirmado', remitoNumero: 'R0110500000041' } }),
    venta({ id: 'd', canal: 'promo', total: 1, formaPago: 'contado_efectivo', comprobanteInterno: { tipo: 'facturaX', puntoVenta: 1104, numero: 22 }, tango: { estado: 'confirmado', facturaNumero: 'A0110400000062', stockEstado: 'confirmado', stockNumero: '0090000000001', stockTipo: 'VPR' } }),
    venta({ id: 'e', canal: 'promo', total: 6000, formaPago: 'cuenta_corriente', clienteId: 'cli3', clienteNombre: 'COTO', clienteCodigoTango: 'CT.002', fecha: ts(12) }),
  ]
  const cobranzas = [
    cob({ id: 'c1', importe: 23602, medios: { efectivo: 0, transferencia: 0, cheques: [{ numero: '1', bancoNombre: 'Galicia', bancoCodigo: '007', importe: 23602, fechaEmision: '', fechaAcreditacion: '', dias: 30, esEcheq: false }], retenciones: [] } }),
    cob({ id: 'c2', importe: 1, empresa: 'rolito', medios: { efectivo: 1, transferencia: 0, cheques: [], retenciones: [] } }),
    cob({ id: 'c3', importe: 1000, clienteId: 'cli3', clienteNombre: 'COTO', codigoTango: 'CT.002', medios: { efectivo: 1000, transferencia: 0, cheques: [], retenciones: [] } }),
  ]
  const r = clasificarReparto(ventas, cobranzas, [], [], problemasDeVenta)

  it('reparte las ventas por tipo con subtotales', () => {
    expect(r.contado.efectivo.total).toBe(48000)
    expect(r.contado.transferencia.total).toBe(12000)
    expect(r.contado.total).toBe(60000)
    expect(r.cuentaCorriente.ventas.map((v) => v.id)).toEqual(['c'])
    expect(r.promo.contado.total).toBe(1)
    expect(r.promo.cuentaCorriente.total).toBe(6000)
    expect(r.totalVendido).toBe(68001)
  })
  it('cobranzas por empresa y medio; el efectivo a rendir suma contado + promo efectivo + cobranzas efectivo', () => {
    expect(r.cobranzas.redonhielo.map((c) => c.id)).toEqual(['c1', 'c3'])
    expect(r.cobranzas.rolito.map((c) => c.id)).toEqual(['c2'])
    expect(r.cobranzas.efectivo).toBe(1001)
    expect(r.cobranzas.cheques).toEqual({ cantidad: 1, total: 23602 })
    expect(r.efectivoARendir).toBe(48000 + 1 + 1001)
  })
  it('cambios, problemas y resumen por cliente', () => {
    expect(r.cambios.unidades).toBe(2)
    expect(r.cambios.lista[0]).toMatchObject({ ventaId: 'a', clienteNombre: 'CLIENTE' })
    expect(r.problemas.map((p) => [p.venta.id, p.motivos])).toEqual([['a', ['No llegó a Tango']], ['e', ['Factura X sin número']]])
    const cliente = r.clientes.find((c) => c.clienteId === 'cli')!
    expect(cliente).toMatchObject({ contado: 48000, cuentaCorriente: 2000, promo: 1, cobrado: 23603, cambios: 2, ventas: 3, cobranzas: 2, problemas: 1 })
    expect(r.clientes.find((c) => c.clienteId === 'cli3')).toMatchObject({ promo: 6000, cobrado: 1000, codigoTango: 'CT.002' })
  })
  it('referencias del cierre', () => {
    expect(referenciasDelReparto([], ventas, [], cobranzas)).toMatchObject({ cantidadVentas: 5, cantidadCobranzas: 3, clientesVisitados: 3, ventasIds: ['a', 'b', 'c', 'd', 'e'] })
  })
})

describe('comprobanteDeVenta', () => {
  it('describe factura ARCA, remito y factura X con su estado', () => {
    expect(describirComprobante(venta({ factura: { estado: 'emitida', numero: 341, puntoVenta: 1, cbteTipo: 6, cae: 'x', caeFchVto: '', importes: importes(1) } }))).toEqual({ etiqueta: 'Factura B', numero: '00001-00000341', estado: 'ok', detalle: 'CAE ok' })
    expect(describirComprobante(venta({ factura: { estado: 'rechazada', numero: 0, puntoVenta: 1, cbteTipo: 1, cae: null, caeFchVto: '', importes: importes(1) } })).estado).toBe('rechazada')
    expect(describirComprobante(venta({}))).toMatchObject({ etiqueta: 'Factura', estado: 'sin_comprobante' })
    expect(describirComprobante(venta({ formaPago: 'cuenta_corriente', comprobanteInterno: { tipo: 'remito', puntoVenta: 1105, numero: 41 } }))).toEqual({ etiqueta: 'Remito', numero: '01105-00000041', estado: 'ok', detalle: '' })
    expect(describirComprobante(venta({ canal: 'promo' }))).toMatchObject({ etiqueta: 'Factura X', estado: 'sin_numero' })
  })
  it('estado en Tango', () => {
    expect(estadoTangoVenta(venta({}))).toMatchObject({ estado: 'pendiente' })
    expect(estadoTangoVenta(venta({ tango: { estado: 'confirmado', remitoNumero: 'R01' } }))).toMatchObject({ estado: 'confirmado', texto: 'Tango ✓ R R01' })
    expect(estadoTangoVenta(venta({ tango: { estado: 'confirmado', facturaNumero: 'A1', stockEstado: 'confirmado', stockNumero: '0090000000001', stockTipo: 'VPR' } }))).toMatchObject({ texto: 'Tango ✓ FAC A1', stock: 'VPR 0090000000001' })
    expect(estadoTangoVenta(venta({ tango: { estado: 'error', ultimoError: 'sin depósito' } }))).toMatchObject({ estado: 'error', texto: 'Tango: sin depósito' })
  })
})
