import { describe, expect, it } from 'vitest'
import { parsearFacturaTango, verificarFactura } from './facturaTango'
import { PdfItem } from './parsePdf'

// Los items tal como los devuelve pdf.js para una factura real de Tango
// (00101-00281898, 13/08/2026). Es un formulario: lo que importa de cada
// fragmento es DÓNDE cae, no en qué orden viene.
const FACTURA_REAL: PdfItem[] = [
  { x: 147.2, y: 25.7, str: "00101-00281898" },
  { x: 126.5, y: 46.7, str: "13" },
  { x: 132.4, y: 46.7, str: "08" },
  { x: 139.8, y: 46.7, str: "26" },
  { x: 36.3, y: 59.3, str: "PAN AMERICAN ENERGY S.L. SUCUR" },
  { x: 111.7, y: 59.3, str: "VENDEDOR:" },
  { x: 138.3, y: 59.3, str: "AD" },
  { x: 156.1, y: 59.3, str: "ADMINISTRACION" },
  { x: 36.3, y: 67.6, str: "Av. MONROE 3078 (y R. BALBIN)" },
  { x: 36.3, y: 76, str: "1428 - CAPITAL FEDERAL" },
  { x: 104.3, y: 88.6, str: "30-69554247-6" },
  { x: 184.2, y: 88.6, str: "PAN" },
  { x: 58.4, y: 97, str: "VALORES 30 DIAS F.F." },
  { x: 24.4, y: 105.4, str: "Responsable inscripto" },
  { x: 21.5, y: 126.3, str: "1.00" },
  { x: 43.6, y: 126.3, str: "AGUA DESMINERALIZADA 1 LT x 6u" },
  { x: 123.5, y: 126.3, str: "R0032100022044" },
  { x: 159.1, y: 126.3, str: "3,250.0000" },
  { x: 187.2, y: 126.3, str: "3,250.00" },
  { x: 20, y: 130.5, str: "20.00" },
  { x: 43.6, y: 130.5, str: "AGUA DESMINERALIZADA 6 LTS" },
  { x: 123.5, y: 130.5, str: "R0032100022044" },
  { x: 159.1, y: 130.5, str: "2,000.0000" },
  { x: 185.7, y: 130.5, str: "40,000.00" },
  { x: 20, y: 134.7, str: "47.00" },
  { x: 43.6, y: 134.7, str: "HIELO EN BOLSA ROLITO 3 KG" },
  { x: 123.5, y: 134.7, str: "R0032100022044" },
  { x: 162, y: 134.7, str: "970.0000" },
  { x: 185.7, y: 134.7, str: "45,590.00" },
  { x: 185.7, y: 218.6, str: "88,840.00" },
  { x: 145.7, y: 226.9, str: "Impuesto Interno %" },
  { x: 17, y: 239.5, str: "GRACIAS POR CONFIAR EN NUESTRO SERVICIO !!!" },
  { x: 17, y: 243.7, str: "EMITIR CHEQUES A LA ORDEN DE REDONHIELO SA." },
  { x: 169.4, y: 243.7, str: "21" },
  { x: 185.7, y: 243.7, str: "18,656.40" },
  { x: 17, y: 252.1, str: "PESOS" },
  { x: 28.9, y: 252.1, str: "CIENTO SIETE MIL CUA" },
  { x: 37.7, y: 252.1, str: "TROCIENTOS NOVENTA Y" },
  { x: 59.9, y: 252.1, str: "SEIS CON 40/100" },
  { x: 145.7, y: 252.1, str: "PERC.IB.BA XXXXXXX" },
  { x: 37.7, y: 260.5, str: "ORIGINAL" },
  { x: 184.2, y: 260.5, str: "107,496.40" },
]

describe('parsearFacturaTango', () => {
  const f = parsearFacturaTango(FACTURA_REAL)

  it('lee el comprobante y su fecha', () => {
    expect(f.puntoVenta).toBe(101)
    expect(f.numero).toBe(281898)
    // La fecha viene partida en tres celdas: 13 | 08 | 26.
    expect(f.fechaEmision.getFullYear()).toBe(2026)
    expect(f.fechaEmision.getMonth()).toBe(7)
    expect(f.fechaEmision.getDate()).toBe(13)
  })

  it('lee el cliente, incluidos los datos que la API de Tango no da', () => {
    expect(f.cliente.razonSocial).toBe('PAN AMERICAN ENERGY S.L. SUCUR')
    expect(f.cliente.cuit).toBe('30-69554247-6')
    expect(f.cliente.domicilio).toBe('Av. MONROE 3078 (y R. BALBIN)')
    expect(f.cliente.cp).toBe('1428')
    expect(f.cliente.localidad).toBe('CAPITAL FEDERAL')
    expect(f.cliente.condicionVenta).toBe('VALORES 30 DIAS F.F.')
    expect(f.cliente.codigo).toBe('PAN')
  })

  it('lee los renglones con su precio unitario', () => {
    expect(f.renglones).toHaveLength(3)
    expect(f.renglones[1]).toMatchObject({
      descripcion: 'AGUA DESMINERALIZADA 6 LTS',
      cantidad: 20,
      precioUnitario: 2000,
      importe: 40000,
    })
    // El remito es de la cabecera, no del renglón: sale una sola vez.
    expect(f.remitosOC).toBe('(R0032100022044)')
  })

  it('lee los totales', () => {
    expect(f.totales.netoGravado).toBe(88840)
    expect(f.totales.iva).toBeCloseTo(18656.4, 2)
    expect(f.totales.ivaAlic).toBe(21)
    expect(f.totales.total).toBeCloseTo(107496.4, 2)
  })

  it('deja el CAE vacío: el PDF de Tango no lo trae', () => {
    expect(f.cae).toBe('')
  })
})

describe('verificarFactura', () => {
  it('no se queja de una factura que cierra', () => {
    expect(verificarFactura(parsearFacturaTango(FACTURA_REAL))).toEqual([])
  })

  it('avisa cuando los renglones no suman el neto', () => {
    const f = parsearFacturaTango(FACTURA_REAL)
    f.renglones[0].importe = 1
    expect(verificarFactura(f)[0]).toContain('neto')
  })

  it('avisa cuando neto + IVA no da el total', () => {
    const f = parsearFacturaTango(FACTURA_REAL)
    f.totales.total = 999
    expect(verificarFactura(f).some((a) => a.includes('total'))).toBe(true)
  })
})

describe('formularios que no se pueden leer', () => {
  it('falla con un mensaje entendible si falta el número', () => {
    const sinNumero = FACTURA_REAL.filter((i) => i.y !== 25.7)
    expect(() => parsearFacturaTango(sinNumero)).toThrow(/número de comprobante/)
  })

  it('falla si no encuentra renglones', () => {
    const sinRenglones = FACTURA_REAL.filter((i) => i.y < 120 || i.y > 215)
    expect(() => parsearFacturaTango(sinRenglones)).toThrow(/renglón/)
  })
})
