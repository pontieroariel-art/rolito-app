import { describe, expect, it } from 'vitest'
import { aCSV, celdaCSV, nombreArchivoCSV } from './csv'

describe('celdaCSV', () => {
  it('deja pasar lo simple', () => {
    expect(celdaCSV('COTO')).toBe('COTO')
    expect(celdaCSV(12)).toBe('12')
  })

  it('usa coma decimal (Excel en español)', () => {
    expect(celdaCSV(1234.56)).toBe('1234,56')
  })

  it('redondea el resto del punto flotante de las sumas de plata', () => {
    expect(celdaCSV(-1.1300000000512227)).toBe('-1,13')
    expect(celdaCSV(0.1 + 0.2)).toBe('0,3')
    expect(celdaCSV(1537672)).toBe('1537672')
  })

  it('no exporta números rotos', () => {
    expect(celdaCSV(NaN)).toBe('')
    expect(celdaCSV(Infinity)).toBe('')
  })

  it('entrecomilla lo que rompería el separador', () => {
    expect(celdaCSV('Faltante; revisar')).toBe('"Faltante; revisar"')
    expect(celdaCSV('dijo "ok"')).toBe('"dijo ""ok"""')
    expect(celdaCSV('dos\nlíneas')).toBe('"dos\nlíneas"')
    expect(celdaCSV(' con espacio')).toBe('" con espacio"')
  })

  it('vacío para null y undefined', () => {
    expect(celdaCSV(null)).toBe('')
    expect(celdaCSV(undefined)).toBe('')
  })
})

describe('aCSV', () => {
  it('arma encabezado y filas separados por punto y coma', () => {
    const csv = aCSV(['Fecha', 'Repartidor', 'Diferencia'], [
      ['2026-09-12', 'Juan Pérez', -1500.5],
      ['2026-09-11', 'Ana; García', 0],
    ])
    expect(csv.split('\r\n')).toEqual([
      'Fecha;Repartidor;Diferencia',
      '2026-09-12;Juan Pérez;-1500,5',
      '2026-09-11;"Ana; García";0',
    ])
  })

  it('sin filas deja solo el encabezado', () => {
    expect(aCSV(['A', 'B'], [])).toBe('A;B')
  })
})

describe('nombreArchivoCSV', () => {
  it('saca acentos, símbolos y espacios', () => {
    expect(nombreArchivoCSV('Cierres de caja 2026-09')).toBe('cierres-de-caja-2026-09.csv')
    expect(nombreArchivoCSV('Liquidación · Don Torcuato')).toBe('liquidacion-don-torcuato.csv')
  })

  it('no deja un nombre vacío', () => {
    expect(nombreArchivoCSV('///')).toBe('export.csv')
  })
})
