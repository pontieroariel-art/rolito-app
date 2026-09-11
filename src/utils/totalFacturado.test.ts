import { describe, expect, it } from 'vitest'
import { desgloseFactura, percepcionVigenteDe, redondear2 } from './totalFacturado'

describe('redondear2 (half even, como el server)', () => {
  it('redondea a centavos y los empates exactos van al par', () => {
    expect(redondear2(10.126)).toBe(10.13)
    expect(redondear2(10.124)).toBe(10.12)
    expect(redondear2(10.125)).toBe(10.12)
    expect(redondear2(10.135)).toBe(10.14)
  })
})

describe('desgloseFactura', () => {
  it('precios netos: suma el 21 % encima (mismo caso que comprobante.test.ts del server)', () => {
    expect(desgloseFactura([{ cantidad: 10, precioUnitario: 1000 }], { preciosIncluyenIva: false }))
      .toEqual({ neto: 10000, iva: 2100, percepcion: 0, total: 12100 })
  })
  it('precios con IVA adentro: el total es el bruto y el neto se descuenta', () => {
    expect(desgloseFactura([{ cantidad: 10, precioUnitario: 1210 }], { preciosIncluyenIva: true }))
      .toEqual({ neto: 10000, iva: 2100, percepcion: 0, total: 12100 })
  })
  it('varios ítems: redondea por ítem y acumula; la percepción va sobre el neto', () => {
    const r = desgloseFactura([{ cantidad: 3, precioUnitario: 333.33 }, { cantidad: 1, precioUnitario: 0.01 }], { preciosIncluyenIva: false, percepcionAlicuota: 3 })
    expect(r.neto).toBe(1000)
    expect(r.iva).toBe(210)
    expect(r.percepcion).toBe(30)
    expect(r.total).toBe(1240)
  })
  it('ítems en cero o sin cantidad no suman', () => {
    expect(desgloseFactura([{ cantidad: 0, precioUnitario: 100 }], { preciosIncluyenIva: false }).total).toBe(0)
  })
})

describe('percepcionVigenteDe', () => {
  const hoy = new Date('2026-09-11T15:00:00Z')
  it('alícuota vigente hoy → esa alícuota; fuera de vigencia, sin vigencia o sin padrón → 0', () => {
    expect(percepcionVigenteDe({ percepcionIIBB: { alicuota: 3, vigenciaDesde: '2026-09-01', vigenciaHasta: '2026-09-30' } }, hoy)).toBe(3)
    expect(percepcionVigenteDe({ percepcionIIBB: { alicuota: 3, vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31' } }, hoy)).toBe(0)
    expect(percepcionVigenteDe({ percepcionIIBB: { alicuota: 3 } }, hoy)).toBe(0)
    expect(percepcionVigenteDe({ percepcionIIBB: { alicuota: 0, vigenciaDesde: '2026-09-01', vigenciaHasta: '2026-09-30' } }, hoy)).toBe(0)
    expect(percepcionVigenteDe({}, hoy)).toBe(0)
    expect(percepcionVigenteDe(null, hoy)).toBe(0)
  })
  it('acepta fechas como Date o Timestamp', () => {
    const ts = { toDate: () => new Date('2026-09-30T12:00:00Z') }
    expect(percepcionVigenteDe({ percepcionIIBB: { alicuota: 1.5, vigenciaDesde: new Date('2026-09-01T12:00:00Z'), vigenciaHasta: ts } }, hoy)).toBe(1.5)
  })
})
