import { describe, it, expect } from 'vitest'
import { claveDetalle, lecturaRecibo, lecturaRemito, textoTango } from './estadoEnTango'

// Casos reales del 2026-09-20 (diagnóstico de las 10 filas pendientes).
describe('qué dice Tango del comprobante que la app anuló', () => {
  it('el remito facturado se distingue del que sigue pendiente', () => {
    expect(lecturaRemito('F').situacion).toBe('facturado')   // LA QUINTA ESTACION
    expect(lecturaRemito('P').situacion).toBe('vigente')     // KLIVE
    expect(lecturaRemito('A').situacion).toBe('anulado')
  })

  it('un recibo solo está resuelto con ANU; imputado o a cuenta siguen vivos', () => {
    expect(lecturaRecibo('ANU').situacion).toBe('anulado')   // FERRANTE
    expect(lecturaRecibo('CTA').situacion).toBe('vigente')   // LUZARDO
    expect(lecturaRecibo('IMP').situacion).toBe('vigente')   // COMBUSTIBLES SAN MARTIN
  })

  it('sin estado es "todavía no sabemos", no "está vivo"', () => {
    expect(lecturaRemito('').situacion).toBe('sin_dato')
    expect(lecturaRecibo(null).situacion).toBe('sin_dato')
    expect(lecturaRecibo(undefined).situacion).toBe('sin_dato')
  })

  it('no se confía en el formato que venga: espacios y minúsculas', () => {
    expect(lecturaRemito(' a ').situacion).toBe('anulado')
    expect(lecturaRecibo('anu').situacion).toBe('anulado')
  })

  it('el estado crudo de Tango se muestra cuando no es uno de los conocidos', () => {
    expect(textoTango(lecturaRecibo('CTA')).texto).toContain('CTA')
  })

  it('facturado pide atención; anulado no', () => {
    expect(textoTango(lecturaRemito('F')).tono).toBe('alerta')
    expect(textoTango(lecturaRemito('A')).tono).toBe('ok')
    expect(textoTango(lecturaRemito('P')).tono).toBe('neutro')
  })

  it('la clave del comprobante no depende del código de cliente', () => {
    // FERRANTE: Tango lo registró con código 000000 en vez de FC.583, así que
    // por la ficha del cliente no aparecía nunca. Por el número, sí.
    expect(claveDetalle('rolito', 'REC', 'x0110800000169')).toBe('rolito_REC_X0110800000169')
    expect(claveDetalle('redonhielo', 'REM', ' R0110500000957 ')).toBe('redonhielo_REM_R0110500000957')
  })
})
