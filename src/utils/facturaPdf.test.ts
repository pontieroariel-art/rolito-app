import { describe, expect, it } from 'vitest'
import {
  cadenaCodigoBarras,
  digitoVerificadorBarras,
  importeEnLetras,
  urlQrAfip,
  type FacturaPdfData,
} from './facturaPdf'

describe('importeEnLetras', () => {
  it('escribe el total de una factura real', () => {
    // Factura A 00101-00282302: el papel dice "CIENTO OCHO MIL CUATROCIENTOS
    // TREINTA Y DOS CON 94/100".
    expect(importeEnLetras(108432.94)).toBe('CIENTO OCHO MIL CUATROCIENTOS TREINTA Y DOS CON 94/100')
  })

  it('resuelve los casos que rompen las tablas ingenuas', () => {
    expect(importeEnLetras(0)).toBe('CERO CON 00/100')
    expect(importeEnLetras(100)).toBe('CIEN CON 00/100')
    expect(importeEnLetras(101)).toBe('CIENTO UNO CON 00/100')
    expect(importeEnLetras(1000)).toBe('MIL CON 00/100')
    expect(importeEnLetras(21)).toBe('VEINTIUNO CON 00/100')
    expect(importeEnLetras(1_000_000)).toBe('UN MILLON CON 00/100')
    expect(importeEnLetras(2_500_000.5)).toBe('DOS MILLONES QUINIENTOS MIL CON 50/100')
  })

  it('redondea a centavos antes de partir el número', () => {
    expect(importeEnLetras(1.999)).toBe('DOS CON 00/100')
  })
})

const FACTURA: FacturaPdfData = {
  letra: 'A',
  codigoTipo: '01',
  titulo: 'FACTURA',
  puntoVenta: 101,
  numero: 282302,
  fechaEmision: new Date(2026, 7, 19),
  cliente: {
    razonSocial: 'OPERADORA DE ESTACIONES DE SERVICIOS S.A.(NORDELTA)',
    domicilio: 'BOULEVARD MACACHA GUEMES 515',
    cp: '1106',
    localidad: 'CAPITAL FEDERAL, (BUENOS AIRES)',
    condicionIva: 'IVA Responsable Inscripto',
    cuit: '30-67877449-5',
    codigo: 'YPF063',
    vendedor: 'ADMINISTRACION',
    condicionVenta: 'VALORES 30 DIAS F.F.',
  },
  renglones: [],
  totales: {
    netoGravado: 89614, exento: 0,
    percIibbCaba: 0, percIibbCabaAlic: 0,
    iva: 18818.94, ivaAlic: 21,
    percIibbBa: 0, percIibbBaAlic: 0,
    internos: 0, total: 108432.94,
  },
  cae: '86339023363846',
  caeVto: new Date(2026, 7, 29),
}

describe('código de barras', () => {
  it('arma los 40 dígitos en el orden que pide ARCA', () => {
    const cadena = cadenaCodigoBarras(FACTURA)
    expect(cadena).toHaveLength(40)
    expect(cadena.slice(0, 11)).toBe('30697668973')  // CUIT del emisor
    expect(cadena.slice(11, 13)).toBe('01')          // tipo de comprobante
    expect(cadena.slice(13, 17)).toBe('0101')        // punto de venta
    expect(cadena.slice(17, 31)).toBe('86339023363846')
    expect(cadena.slice(31, 39)).toBe('20260829')    // vencimiento del CAE
  })

  it('calcula el dígito verificador', () => {
    // impares × 3 + pares, completado al múltiplo de 10.
    expect(digitoVerificadorBarras('306976689730101018633902336384620260829')).toBe(6)
    expect(digitoVerificadorBarras('0')).toBe(0)
    expect(digitoVerificadorBarras('1')).toBe(7)
  })
})

describe('QR de la RG 4892', () => {
  it('codifica el comprobante en el JSON base64 que espera ARCA', () => {
    const url = urlQrAfip(FACTURA)
    expect(url.startsWith('https://www.afip.gob.ar/fe/qr/?p=')).toBe(true)
    const datos = JSON.parse(atob(url.split('?p=')[1]))
    expect(datos).toMatchObject({
      ver: 1,
      fecha: '2026-08-19',
      cuit: 30697668973,
      ptoVta: 101,
      tipoCmp: 1,
      nroCmp: 282302,
      importe: 108432.94,
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: 80,
      nroDocRec: 30678774495,
      tipoCodAut: 'E',
      codAut: 86339023363846,
    })
  })
})
