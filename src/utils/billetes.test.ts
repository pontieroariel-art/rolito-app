import { describe, expect, it } from 'vitest'
import { compararDesgloses, conCambioChico, conCantidad, conteoCompleto, conteoVacio, conteoValido, desgloseContado, desgloseVacio, desgloseValido, sinEfectivo, totalConteo, totalDesglose } from './billetes'

describe('totalDesglose / conCantidad / conCambioChico', () => {
  it('suma denominación por cantidad más el cambio chico', () => {
    let d = desgloseVacio()
    d = conCantidad(d, 20000, 15)
    d = conCantidad(d, 10000, 10)
    d = conCantidad(d, 2000, 6)
    d = conCambioChico(d, 300)
    expect(d.total).toBe(412_300)
    expect(totalDesglose(d)).toBe(412_300)
  })
  it('cantidades negativas o con decimales se normalizan; el cambio chico se redondea', () => {
    const d = conCambioChico(conCantidad(desgloseVacio(), 500, -3.7), 149.6)
    expect(d.billetes['500']).toBe(0)
    expect(d.cambioChico).toBe(150)
    expect(d.total).toBe(150)
  })
  it('cargar una fila saca la marca "sin efectivo"', () => {
    const d = conCantidad(sinEfectivo(true), 1000, 2)
    expect(d.sinEfectivo).toBe(false)
    expect(d.total).toBe(2000)
  })
})

describe('desgloseContado / conteoCompleto', () => {
  it('vacío no cuenta como contado; una fila o la marca sí', () => {
    expect(desgloseContado(desgloseVacio())).toBe(false)
    expect(desgloseContado(conCantidad(desgloseVacio(), 500, 1))).toBe(true)
    expect(desgloseContado(conCambioChico(desgloseVacio(), 50))).toBe(true)
    expect(desgloseContado(sinEfectivo(true))).toBe(true)
    expect(sinEfectivo(true).total).toBe(0)
  })
  it('el conteo está completo solo con las dos empresas contadas', () => {
    const c = conteoVacio()
    expect(conteoCompleto(c)).toBe(false)
    c.redonhielo = conCantidad(c.redonhielo, 20000, 1)
    expect(conteoCompleto(c)).toBe(false)
    c.rolito = sinEfectivo(true)
    expect(conteoCompleto(c)).toBe(true)
    expect(totalConteo(c)).toBe(20_000)
  })
})

describe('desgloseValido / conteoValido', () => {
  it('rechaza cantidades no enteras, negativas o un total que no cierra', () => {
    const ok = conCantidad(desgloseVacio(), 10000, 3)
    expect(desgloseValido(ok)).toBe(true)
    expect(desgloseValido({ ...ok, total: 1 })).toBe(false)
    expect(desgloseValido({ ...ok, billetes: { ...ok.billetes, '500': 1.5 } })).toBe(false)
    expect(desgloseValido({ ...ok, cambioChico: -1 })).toBe(false)
    expect(conteoValido({ redonhielo: ok, rolito: desgloseVacio() })).toBe(true)
  })
})

describe('compararDesgloses', () => {
  it('lista solo las filas que difieren, con las dos cantidades', () => {
    const a = conCambioChico(conCantidad(conCantidad(desgloseVacio(), 10000, 10), 500, 2), 100)
    const b = conCambioChico(conCantidad(conCantidad(desgloseVacio(), 10000, 9), 500, 2), 150)
    expect(compararDesgloses(a, b)).toEqual([
      { fila: '10000', a: 10, b: 9 },
      { fila: 'cambioChico', a: 100, b: 150 },
    ])
    expect(compararDesgloses(a, a)).toEqual([])
  })
})
