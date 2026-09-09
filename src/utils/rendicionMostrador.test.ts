import { describe, expect, it } from 'vitest'
import type { Cobranza, Liquidacion, VentaVentanilla } from '@/types'
import { calcularMostrador, fueraDelCierre, valoresEnPapel } from './rendicionMostrador'

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }) as unknown as VentaVentanilla['fecha']
const venta = (x: Partial<VentaVentanilla>): VentaVentanilla => ({
  id: 'v', plantaId: 'torcuato', canal: 'contado', cajaId: 'u1', cajaNombre: 'Nico', clienteNombre: 'C',
  items: [{ productoId: 'bolsa_10kg', nombre: 'Bolsa 10', cantidad: 10, precioUnitario: 100 }],
  total: 1000, formaPago: 'contado_efectivo', estado: 'pendiente_entrega', turno: 1, turnoEstado: 'en_espera', fecha: ts(1000),
  ...x,
} as VentaVentanilla)
const cobranza = (x: Partial<Cobranza>): Cobranza => ({
  id: 'c', origen: 'caja', plantaId: 'torcuato', registradoPor: { uid: 'u1', nombre: 'Nico' }, clienteId: 'k', clienteNombre: 'Kiosco',
  importe: 500, formaPago: 'contado_efectivo', fecha: ts(2000), ...x,
} as Cobranza)

describe('calcularMostrador', () => {
  const ventas = [
    venta({ id: 'a', total: 1000, formaPago: 'contado_efectivo' }),
    venta({ id: 'b', total: 700, formaPago: 'contado_transferencia', items: [{ productoId: 'barra', nombre: 'Barra', cantidad: 2, precioUnitario: 350 }] }),
    venta({ id: 'c', total: 5000, formaPago: 'cuenta_corriente', items: [{ productoId: 'bolsa_10kg', nombre: 'Bolsa 10', cantidad: 60, precioUnitario: 0 }] }),
    venta({ id: 'd', canal: 'promo', total: 300, formaPago: 'contado_efectivo' }),
    venta({ id: 'e', canal: 'promo', total: 200, formaPago: 'cuenta_corriente' }),
  ]
  const cobranzas = [
    cobranza({ id: 'c1', importe: 500 }),
    cobranza({ id: 'c2', importe: 1300, formaPago: 'mixto', numeroRecibo: 'RS-1', medios: { efectivo: 200, transferencia: 100, cheques: [{ numero: '77', bancoCodigo: '007', bancoNombre: 'Galicia', fechaEmision: '2026-09-09', fechaAcreditacion: '2026-10-09', dias: 30, importe: 900 }], retenciones: [{ tipo: 'iibb_pba', nroCertificado: '5', importe: 100 }] } }),
  ]
  const liq = [{ id: '2026-09-09_ch1', choferId: 'ch1', choferNombre: 'Pedro', efectivoARendir: 10000, efectivoRecibido: 9900, diferenciaEfectivo: -100 } as Liquidacion]

  it('separa contado/promo por forma de pago y suma bultos por producto', () => {
    const m = calcularMostrador(ventas, cobranzas, liq)
    expect(m.ventas).toEqual({ cantidad: 5, contadoEfectivo: 1000, contadoTransferencia: 700, cuentaCorriente: 5000, promoEfectivo: 300, promoTransferencia: 0, promoCuentaCorriente: 200, total: 7200 })
    // a (10) + c (60) + d (10) + e (10) bolsas; b son 2 barras
    expect(m.bultos).toEqual([{ productoId: 'bolsa_10kg', nombre: 'Bolsa 10', cantidad: 90 }, { productoId: 'barra', nombre: 'Barra', cantidad: 2 }])
  })
  it('cobranzas: efectivo y transferencia por medios, cheques y retenciones aparte', () => {
    const m = calcularMostrador(ventas, cobranzas)
    expect(m.cobranzas).toEqual({ cantidad: 2, efectivo: 700, transferencia: 100, cheques: { cantidad: 1, total: 900 }, retenciones: { cantidad: 1, total: 100 }, total: 1800 })
  })
  it('efectivo a rendir = contado efectivo + promo efectivo + cobranzas efectivo + recibido de repartidores', () => {
    expect(calcularMostrador(ventas, cobranzas).efectivoARendir).toBe(1000 + 300 + 700)
    const m = calcularMostrador(ventas, cobranzas, liq)
    expect(m.recibido).toEqual({ liquidaciones: [{ id: '2026-09-09_ch1', choferId: 'ch1', choferNombre: 'Pedro', efectivoARendir: 10000, efectivoRecibido: 9900, diferenciaEfectivo: -100 }], efectivo: 9900 })
    expect(m.efectivoARendir).toBe(1000 + 300 + 700 + 9900)
  })
  it('sin nada, todo en cero', () => {
    const m = calcularMostrador([], [])
    expect(m.efectivoARendir).toBe(0)
    expect(m.bultos).toEqual([])
  })
  it('valoresEnPapel lista cheques y certificados con su recibo y cliente', () => {
    const v = valoresEnPapel(cobranzas)
    expect(v.cheques).toEqual([{ cobranzaId: 'c2', numeroRecibo: 'RS-1', clienteNombre: 'Kiosco', numero: '77', bancoNombre: 'Galicia', fechaAcreditacion: '2026-10-09', importe: 900 }])
    expect(v.retenciones).toEqual([{ cobranzaId: 'c2', numeroRecibo: 'RS-1', clienteNombre: 'Kiosco', tipo: 'iibb_pba', nroCertificado: '5', importe: 100 }])
  })
  it('fueraDelCierre: lo posterior al cierre; sin cierre, nada', () => {
    expect(fueraDelCierre(ventas, null)).toEqual([])
    expect(fueraDelCierre([venta({ id: 'x', fecha: ts(5000) }), venta({ id: 'y', fecha: ts(1000) })], 3000).map((v) => v.id)).toEqual(['x'])
  })
})
