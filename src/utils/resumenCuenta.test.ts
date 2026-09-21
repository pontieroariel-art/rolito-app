import { describe, it, expect } from 'vitest'
import { armarResumen, movimientosDe, sucursalesDe, type ComprobanteIndice } from './resumenCuenta'

// El caso de COMBUSTIBLES SAN MARTIN, con los números reales del 20/09.
const indice: Record<string, ComprobanteIndice> = {
  FAC_A0010100282609: { tipo: 'FAC', familia: 'factura', numero: 'A0010100282609', fecha: '2026-08-31', importe: 273193.8, estado: 'PEN' },
  REC_X0110600000168: { tipo: 'REC', familia: 'recibo',  numero: 'X0110600000168', fecha: '2026-09-15', importe: 200000,   estado: 'IMP' },
  NC_A0000300008802:  { tipo: 'NC',  familia: 'credito', numero: 'A0000300008802', fecha: '2026-09-16', importe: 52780.3,  estado: 'PEN' },
  ND_A0000300000011:  { tipo: 'ND',  familia: 'debito',  numero: 'A0000300000011', fecha: '2026-09-17', importe: 1000,     estado: 'PEN' },
  // Fuera del período y anulado: no tienen que aparecer.
  FAC_A0010100200000: { tipo: 'FAC', familia: 'factura', numero: 'A0010100200000', fecha: '2026-03-02', importe: 99999,    estado: 'PEN' },
  REC_X0110600000099: { tipo: 'REC', familia: 'recibo',  numero: 'X0110600000099', fecha: '2026-09-10', importe: 50000,    estado: 'ANU' },
}

describe('movimientosDe', () => {
  const ms = movimientosDe(indice, '2026-08-01', '2026-09-20')

  it('la factura y la nota de débito van al Debe; el recibo y la nota de crédito al Haber', () => {
    expect(ms.map((m) => [m.tipo, m.debe, m.haber])).toEqual([
      ['FAC', 273193.8, 0],
      ['REC', 0, 200000],
      ['NC',  0, 52780.3],
      ['ND',  1000, 0],
    ])
  })

  it('deja afuera lo anulado y lo que cae fuera del período', () => {
    const numeros = ms.map((m) => m.numero)
    expect(numeros).not.toContain('X0110600000099')   // anulado en Tango
    expect(numeros).not.toContain('A0010100200000')   // de marzo
  })

  it('ordena por fecha, y dentro del día por número (el saldo no puede bailar entre consultas)', () => {
    const mismoDia = movimientosDe({
      b: { tipo: 'FAC', familia: 'factura', numero: 'B002', fecha: '2026-09-01', importe: 10, estado: 'PEN' },
      a: { tipo: 'FAC', familia: 'factura', numero: 'A001', fecha: '2026-09-01', importe: 20, estado: 'PEN' },
    }, '2026-09-01', '2026-09-30')
    expect(mismoDia.map((m) => m.numero)).toEqual(['A001', 'B002'])
  })
})

describe('armarResumen', () => {
  const ms = movimientosDe(indice, '2026-08-01', '2026-09-20')

  it('calcula el saldo inicial hacia atrás desde el saldo de hoy', () => {
    // Saldo de hoy 65.533,50. Neto del período: +273.193,80 −200.000 −52.780,30 +1.000 = 21.413,50
    const r = armarResumen(ms, 65533.5)
    expect(r.saldoInicial).toBe(44120)
    expect(r.saldoFinal).toBe(65533.5)
  })

  it('el saldo corrido cierra exactamente en el saldo final', () => {
    const r = armarResumen(ms, 65533.5)
    expect(r.movimientos.map((m) => m.saldo)).toEqual([317313.8, 117313.8, 64533.5, 65533.5])
    expect(r.movimientos[r.movimientos.length - 1].saldo).toBe(r.saldoFinal)
  })

  it('los totales de Debe y Haber salen de los mismos movimientos', () => {
    const r = armarResumen(ms, 65533.5)
    expect(r.totalDebe).toBe(274193.8)
    expect(r.totalHaber).toBe(252780.3)
    expect(r.saldoInicial + r.totalDebe - r.totalHaber).toBeCloseTo(r.saldoFinal, 2)
  })

  it('un período que termina antes de hoy descuenta lo que pasó después', () => {
    const hastaAgosto = movimientosDe(indice, '2026-08-01', '2026-08-31')
    const despues     = movimientosDe(indice, '2026-09-01', '2026-09-20')
    const r = armarResumen(hastaAgosto, 65533.5, despues)
    // Al 31/08 la cuenta cerraba con la factura recién emitida y nada cobrado.
    expect(r.saldoFinal).toBe(317313.8)
    expect(r.saldoInicial).toBe(44120)
  })

  it('sin movimientos, el saldo inicial y el final son el de hoy', () => {
    const r = armarResumen([], 1234.56)
    expect(r).toMatchObject({ saldoInicial: 1234.56, saldoFinal: 1234.56, totalDebe: 0, totalHaber: 0 })
  })

  it('redondea a dos decimales: Tango manda siete y la suma arrastra cola', () => {
    const r = armarResumen(movimientosDe({
      a: { tipo: 'FAC', familia: 'factura', numero: 'A1', fecha: '2026-09-01', importe: 0.1, estado: 'PEN' },
      b: { tipo: 'FAC', familia: 'factura', numero: 'A2', fecha: '2026-09-02', importe: 0.2, estado: 'PEN' },
    }, '2026-09-01', '2026-09-30'), 0.3)
    expect(r.saldoInicial).toBe(0)
    expect(r.movimientos[1].saldo).toBe(0.3)
  })
})

describe('sucursalesDe', () => {
  it('une las dos empresas y dice en cuál existe cada sucursal', () => {
    // PETROLGAS EZEIZA, caso real: FC.515 solo está en Redonhielo.
    expect(sucursalesDe({ redonhielo: ['FC.515', 'CO.015'], rolito: ['CO.015'] })).toEqual([
      { codigo: 'CO.015', empresas: ['redonhielo', 'rolito'] },
      { codigo: 'FC.515', empresas: ['redonhielo'] },
    ])
  })

  it('el cliente con códigos totalmente distintos entre empresas no rompe nada', () => {
    // SAN ISIDRO COCINAS: COM158 en Redonhielo, GD.025 en Rolito.
    expect(sucursalesDe({ redonhielo: ['COM158'], rolito: ['GD.025'] })).toEqual([
      { codigo: 'COM158', empresas: ['redonhielo'] },
      { codigo: 'GD.025', empresas: ['rolito'] },
    ])
  })

  it('ignora códigos vacíos y no repite', () => {
    expect(sucursalesDe({ redonhielo: ['A', '', 'A'], rolito: ['A'] })).toEqual([
      { codigo: 'A', empresas: ['redonhielo', 'rolito'] },
    ])
  })
})
