import { describe, expect, it } from 'vitest'
import { avisoDescuadre, controlarRecibo } from './cobranzasControl'

describe('control del recibo del lado servidor (2026-09-22)', () => {
  const ok = {
    importe: 45000.5,
    imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: 'A-0001-00000001', saldoAlMomento: 60000, importeImputado: 45000.5 }],
    medios: { efectivo: 20000, transferencia: 0, cheques: [{ importe: 25000.5, numero: '1' }], retenciones: [], aCuentaAplicado: [] },
  }

  it('el recibo que arma la app cuadra', () => {
    expect(controlarRecibo(ok)).toBeNull()
    // Con plata a cuenta declarada y sin imputación (pago adelantado).
    expect(controlarRecibo({ importe: 5000, aCuenta: 5000, imputaciones: [], medios: { efectivo: 5000, cheques: [], retenciones: [] } })).toBeNull()
    // Valores mayores a lo imputado con el resto a cuenta.
    expect(controlarRecibo({ ...ok, importe: 50000.5, aCuenta: 5000, medios: { ...ok.medios, efectivo: 25000 } })).toBeNull()
    // Redondeo de centavos dentro de la tolerancia.
    expect(controlarRecibo({ ...ok, importe: 45001 })).toBeNull()
  })

  it('importe distinto de los valores, imputado de más o a cuenta que no cierra: descuadre', () => {
    expect(controlarRecibo({ ...ok, importe: 1 })?.motivos).toContain('El importe del recibo no es la suma de los valores recibidos.')
    expect(controlarRecibo({ ...ok, imputaciones: [{ ...ok.imputaciones[0], importeImputado: 60000 }] })?.motivos).toContain('Lo imputado a facturas supera los valores recibidos.')
    expect(controlarRecibo({ ...ok, aCuenta: 10000 })?.motivos).toContain('Lo que queda a cuenta no es recibido menos imputado.')
    expect(controlarRecibo({ importe: 0, imputaciones: [], medios: { efectivo: 0, cheques: [], retenciones: [] } })?.motivos).toContain('No hay valores recibidos.')
  })

  it('imputación en cero o mayor al saldo, y saldo a favor mal aplicado', () => {
    expect(controlarRecibo({ ...ok, importe: 100000, medios: { ...ok.medios, efectivo: 75000 }, imputaciones: [{ ...ok.imputaciones[0], importeImputado: 70000 }], aCuenta: 30000 })?.motivos)
      .toContain('Hay una imputación mayor al saldo de la factura.')
    expect(controlarRecibo({ ...ok, imputaciones: [{ ...ok.imputaciones[0], importeImputado: 0 }], aCuenta: 45000.5 })?.motivos).toContain('Hay una imputación en cero.')
    expect(controlarRecibo({ importe: 1000, imputaciones: [{ saldoAlMomento: 5000, importeImputado: 500 }], aCuenta: 500, medios: { efectivo: 0, cheques: [], retenciones: [], aCuentaAplicado: [{ importe: 1000, reciboNumero: 'RS-1' }] } })?.motivos)
      .toContain('Aplica saldo a favor y deja plata a cuenta en el mismo recibo.')
    expect(controlarRecibo({ importe: 1000, imputaciones: [{ saldoAlMomento: 5000, importeImputado: 1000 }], medios: { efectivo: 0, cheques: [], retenciones: [], aCuentaAplicado: [{ importe: 1000 }] } })?.motivos)
      .toContain('Hay un saldo a favor aplicado en cero o sin recibo.')
  })

  it('el aviso dice recibo, quién, cliente, los tres importes y el primer motivo', () => {
    const d = controlarRecibo({ ...ok, importe: 1 })!
    const a = avisoDescuadre({ numeroRecibo: 'RS-000862', registradoPor: { nombre: 'VAÑEK JUAN CRUZ' }, clienteNombre: 'Cliente SA' }, d)
    expect(a.titulo).toBe('Recibo que no cuadra')
    expect(a.cuerpo).toContain('Recibo RS-000862 de VAÑEK JUAN CRUZ a Cliente SA')
    expect(a.cuerpo).toContain('importe $1')
    expect(a.cuerpo).toContain('No se mandó a Tango')
  })
})
